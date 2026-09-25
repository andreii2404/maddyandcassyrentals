# Rental Fulfillment (post-approval booking workflow) — Design

Date: 2026-09-21
Status: Approved with revisions (2026-09-21). Next step: implementation plan. No code written yet.
Area: Admin > Booking Review (`app/admin/bookings/[bookingId]/AdminBookingDetail.tsx`)

## 1. Goal

After a booking is Approved **and** its confirmation email was successfully sent, replace the
review tabs with a **Rental Fulfillment** workflow: Pickup, Return, Item Condition,
Charges & Payments, Customer Updates, Complete Rental. Completing a rental marks the booking
Completed, applies the existing loyalty rules, and emails the customer a Rental Completed
summary. Nothing existing is deleted; old records stay reachable via **View Booking Record**.

## 2. Findings that shape the design (verified in code)

| Finding | Consequence |
|---|---|
| Statuses are `pending → approved → confirmed → ready_for_release → released → returned` (+ `cancelled`, `rejected`). There is no `completed` value. `returned` already means "booking is now complete" (RPC customer message, `isClosedRecord`). | **`returned` is the stored value; the UI and emails call it "Completed".** No enum change, no edits to the booking-creation RPCs. |
| Loyalty = 11th rental gets ₱200 off (`LOYALTY_REWARD_RENTAL_NUMBER`, `LOYALTY_REWARD_DISCOUNT` in `src/lib/promotions.ts`). Completed count is `count(bookings where customer_id = uid and status = 'returned')` inside the booking RPCs. There is **no points ledger**. Guests never earn loyalty. | Completing a rental *is* the loyalty step. It cannot double-award on reopen/refresh because the count derives from status and the reward is single-use per account (`loyalty_discount_amount > 0`). The email shows rental progress toward the existing reward, or the earned reward, using the `promotions.ts` constants — never invented points. Guest emails omit loyalty entirely. |
| After `approved`, the admin still confirms the booking once payment, documents and agreement are complete (`ADMIN_BOOKING_ACTIONS.approved`), and countersigns the agreement. | Decision (user-confirmed): a **Follow-up strip** carries these outstanding actions inside the new view (§4.2). |
| Approval-email success lives only in browser state (`approvalEmailFailed`, `confirmationEmailSentAt`). | Persist it: new `bookings.approval_email_sent_at` (§5). |
| Balance = `totalAmount − Σ verified booking_payment_submissions.declared_amount`. Handover to `released` is guarded on that balance (`20260822090000_balance_payment_and_handover_guard.sql`). There is no admin "record cash payment" action. | Extra charges track their own collection (§5) rather than altering the payments schema. |
| Approval emails go through `sendBookingStatusEmail` (Resend, idempotency key, never throws). Receipt emails track `emailed_at`. | Reuse for Customer Updates and Rental Completed emails. |

## 3. When the Fulfillment view shows

Tracked by `bookings.approval_email_status` (`sent` | `failed` | `legacy` | null) and
`approval_email_sent_at`.

```
statusOk = status in (approved, confirmed, ready_for_release, released, returned)

fulfillmentMode = statusOk AND approval_email_status in ('sent', 'legacy')
```

| `approval_email_status` | Who | View |
|---|---|---|
| `sent` | New bookings after the email succeeded (initial send or a later resend) | Fulfillment |
| `failed` | New bookings whose approval email failed | Old review tabs + existing **Resend Email**; switches to Fulfillment when a resend succeeds |
| `legacy` | Bookings already approved when this ships (set once by the migration, only on rows that have `approved_at`) | Fulfillment, with a notice **"Confirmation email status unavailable"** and an optional **Resend Email** button. Never forced. |
| null | New approval whose email has not been attempted yet (in-flight) | Old review tabs (transient) |

- A successful resend on a `legacy` booking sets it to `sent`; a failed one leaves it `legacy`.
- `returned` bookings open in Fulfillment mode as a Completed summary with Resend Completion
  Email and history — never the old tabs.

## 4. UI

### 4.1 Tabs (Poppins, existing Maddy & Cassy tokens, no arrows, no live indicators)

Pickup · Return · Item Condition · Charges & Payments · Customer Updates · Complete Rental,
plus a **View Booking Record** button that opens the full read-only record (customer, rental,
requirements, payment & documents, agreement, final review, status history) — the old sections
rendered unchanged inside a collapsible/drawer, without the action controls.

### 4.2 Follow-up strip (top of the view, unfinished items only)

Lists **only** items that are still unfinished, each with its existing action:
- Payment submissions awaiting review → opens existing payment review.
- Agreement needs countersignature → existing countersign confirmation (reuses current state/modal).
- Booking not yet Confirmed / not Ready for Handover → existing `ADMIN_BOOKING_ACTIONS` cards
  and confirmation popup.
- Legacy email notice + optional Resend Email (only for `legacy` bookings).

Completed items are never listed. When payment, countersign, confirmation and handover
requirements are all complete, the strip is **removed entirely** (not collapsed, no "all done"
placeholder). The same "unresolved required admin action" computation feeds the Complete
Rental guard (§6).

### 4.3 Tab behavior

- **Pickup** — "Mark as Picked Up" (requires status `ready_for_release`; uses the existing
  `released` transition, so the existing balance-before-handover rule is **not bypassed**).
  If a required balance remains, the button is disabled with a plain message ("The remaining
  balance must be settled before pickup can be confirmed") and a link to the balance in
  Charges & Payments. Actual pickup date/time (defaults to now, editable), admin notes.
- **Return** — "Mark as returned" (requires picked up), actual return date/time, notes. Does
  **not** change booking status; that happens at Complete Rental.
- **Item Condition** — Good Condition / Has Damage, admin notes, optional photos (private
  storage, images only, size/count limits). "Has Damage" offers a shortcut to add a damage
  charge.
- **Charges & Payments** — must clearly answer *"does the customer still owe anything?"*
  1. Original booking balance (total − verified payments).
  2. Extra charges list. Each charge has: **type** (Late Fee / Damage Fee / Other), **amount**
     (admin types it; no defaults), **reason / admin note**, **payment status**
     (Unpaid / Paid), **payment method when paid** (Cash / GCash / Other), **paid date/time**,
     **recorded by** (admin name when available; see §5), and a **Void** action (with reason).
     No delete. Voided charges stay visible, struck through, and don't count.
  3. Summary: **"Nothing owed — fully paid"** or **"Customer still owes ₱X"** with the
     breakdown (unpaid balance + unpaid active charges).
- **Customer Updates** — subject + message, **Preview** (renders the actual email), **Send**,
  and a history list (subject, message, sent date/time, delivery result, admin note, related
  charge). Quick-start templates fill subject and message but stay fully editable: damage
  notice, late pickup, remaining balance (amount pre-filled from the live balance, still
  editable). A charge row has a "Notify customer" shortcut that pre-links the update to it.
  Failed messages show **Resend** on the same history row.
- **Complete Rental** — checklist: item returned ✓, condition checked ✓, balance and extra
  charges settled or explicitly resolved ✓, no unresolved required admin action ✓. Disabled
  until all pass, then a confirmation popup. The server enforces the same rules. After
  success: Completed summary + email status + **Resend Email** if it failed.
  "Settled or explicitly resolved" means every extra charge is **Paid** or **Voided (with a
  reason)**, and the original balance is fully paid.

### 4.4 View Booking Record (permanent, read-only)

Always available, in every state. Contains the original approval flow: customer, rental,
requirements, payment and documents, agreement, **final agreement PDF** (existing
`/api/admin/bookings/[bookingId]/pdf`), final review, status history, and an **email
history** (approval email, receipt emails, customer updates, completion email, with
date/time and delivery result). Read-only: no action controls.

## 5. Data (additive migration only; nothing dropped or rewritten)

- `bookings.approval_email_status text null check in ('sent','failed','legacy')`,
  `bookings.approval_email_sent_at timestamptz null`,
  `bookings.completion_email_sent_at timestamptz null`,
  `bookings.completion_email_to text null`.
  The migration sets `approval_email_status = 'legacy'` once, only on existing rows that have
  `approved_at` (a value in a new column; no existing column or row content is changed).
- `booking_fulfillment_records` (1 row per booking): `picked_up bool`, `actual_pickup_at`,
  `pickup_notes`, `returned bool`, `actual_return_at`, `return_notes`,
  `item_condition` (`good` | `damaged` | null), `condition_notes`,
  `condition_photo_paths text[]`, `updated_by`, `updated_at`.
- `booking_charges`: `id`, `booking_id`, `charge_type` (`late_fee` | `damage_fee` | `other`),
  `amount numeric(12,2) check (> 0)`, `reason` (required admin note),
  `payment_status` (`unpaid` | `paid`, default `unpaid`),
  `payment_method` (`cash` | `gcash` | `other`; required when paid, null when unpaid),
  `paid_at timestamptz` (required when paid), `paid_recorded_by uuid`,
  `created_by uuid`, `created_at`, `voided_at`, `voided_by uuid`, `void_reason`.
  Check constraints enforce paid ⇔ (method and `paid_at` present). **No delete**: no delete
  policy, and the API only voids. "Recorded by" is the logged-in admin's user id, shown by
  the admin's profile name; no new Maddy/Cassy picker is added.
- `booking_customer_updates`: `id`, `booking_id`, `subject`, `message`, `sent_to`,
  `sent_by uuid`, `first_attempt_at`, `sent_at` (null until delivered),
  `delivery_status` (`sent` | `failed`), `delivery_attempts int`, `last_attempt_at`,
  `admin_note`, `related_charge_id uuid null references booking_charges(id)`.
  A resend updates this same row. It never inserts a new update or touches `booking_charges`.
- RLS: admin-only read/write (same `private.is_admin()` pattern as existing tables);
  customers get no direct access. Photos in a private bucket, admin-only policies, signed
  URLs on demand (same approach as `getBookingFileUrl`). Bucket/policy setup to be confirmed
  against the existing document bucket during planning.
- All writes audited via `private.log_audit_event`.

## 6. Server logic

- **Complete Rental** = one SECURITY DEFINER RPC `admin_complete_rental(booking_id, note)`,
  transactional with row lock. It validates: status = `released`; `returned = true`;
  `item_condition` set; every non-voided charge is `paid`; verified payments ≥ total; no
  payment submission still awaiting review. Any failure raises a coded error that the API maps
  to a plain list of what is missing. On success it calls the existing `released → returned`
  transition (frees `unit_reservations`, writes status history, notification, audit).
  Calling it again on an already-`returned` booking is a no-op returning the current row
  (idempotent). The Follow-up strip and this RPC share one definition of "unresolved required
  admin action" so the UI and the server cannot disagree.
- **Loyalty — existing rule only, nothing new.** Completion adds no loyalty write and defines
  no new reward. The rule already in the codebase is the 11th-rental discount:
  `LOYALTY_REWARD_RENTAL_NUMBER` / `LOYALTY_REWARD_DISCOUNT` in `src/lib/promotions.ts`
  (mirrored by the `>= 10` and `least(200, …)` checks in the booking RPCs). The completion
  email reads those constants (never a literal ₱200) plus the customer's completed count
  (`status = 'returned'`) and whether their reward is already used (`loyalty_discount_amount > 0`
  on a non-cancelled booking). Because eligibility is derived from status and the reward is
  single-use, retrying completion or reopening the booking cannot award anything twice.
  Guests and customers with nothing to report get no loyalty section. If the business rule
  in `promotions.ts` changes later, the email follows it automatically.
- **Emails (server, `server-only`)**: `sendCustomerUpdateEmail`, `sendRentalCompletedEmail`.
  Both reuse `sendBookingStatusEmail`'s transport pattern (Resend, idempotency key, friendly
  outcome, never throws, technical errors only in server logs).
  - Rental Completed email content: customer name, booking number, rented item(s), completed
    date, final payment/charge summary, loyalty block (only when the customer is a
    signed-in account **and** there is progress or a reward to report), updated loyalty
    status, short thank-you. Plain, friendly wording.
  - Failure: booking stays Completed; `completion_email_sent_at` stays null; UI shows
    **Resend Email** → `POST /api/admin/bookings/[id]/completion-email` (rate-limited,
    `requireActiveAdmin`, same shape as the existing confirmation-email route).
- New routes (all `requireActiveAdmin` + `enforceRateLimit`): fulfillment update, charges
  (add, mark paid, void), customer-update preview/send/resend, completion-email resend.
- `sendBookingApprovalEmail` records the outcome on the booking: `sent` + `approval_email_sent_at`
  on success (initial send and resend), `failed` on a failed initial send. A failed resend
  never downgrades `sent` or `legacy`.
- Customer update resend uses the stored subject/message on the same row, increments
  `delivery_attempts`, and uses an attempt-specific delivery key so the provider does not
  de-duplicate it.

## 7. Error handling

- Every failure shows a plain-language message; technical detail is logged server-side only
  (matches current email routes).
- Guard failures on Complete Rental list exactly what is missing.
- Email provider failure never rolls back approval, a customer update record (stored as
  `failed`, resendable) or completion.

## 8. Testing

- Unit: charge/balance math, loyalty progress/eligibility text, email builders (loyalty block
  present/absent, guest), fulfillment-mode gate.
- SQL/RPC (existing `scripts/testBookingManagement.ts` style): `admin_complete_rental`
  guards, idempotency on repeat call, no second loyalty reward across two completions.
- Manual browser pass at desktop and mobile widths for each tab and the failure/resend path.

## 9. Out of scope

Changing loyalty rules, a points ledger, new booking statuses, customer-facing fulfillment UI,
automatic late/damage fee amounts, live-update indicators or arrows, deleting or rewriting any
existing booking, payment, document, agreement, loyalty or customer data.

## 10. Confirmed decisions (2026-09-21)

1. `returned` stays the stored status, displayed as "Completed".
2. Pickup uses the existing `released` transition and its balance guard; the guard is not bypassed.
3. Extra charges carry type, amount, reason, Unpaid/Paid, method (Cash/GCash/Other), paid
   date/time, recorded-by, and Void (no delete). They are recorded per charge, not through
   the customer payment-proof flow.
4. Legacy approved bookings open Fulfillment without a resend, with "Confirmation email
   status unavailable" and an optional Resend Email. New bookings need Approved + email sent.
5. The Follow-up strip lists unfinished items only and disappears entirely when none remain.
6. Complete Rental is transactional and idempotent, with the guards in §4.3/§6.
7. Loyalty uses the existing rule and constants only; no double award on retry.
8. Customer Updates persist subject, message, sent time, delivery result, admin note and
   related charge; failed messages resend on the same row.
9. View Booking Record is the permanent read-only history, including the agreement PDF and
   email history.
10. Tabs: Pickup | Return | Item Condition | Charges & Payments | Customer Updates | Complete Rental.

## 11. Addendum (2026-09-25): full lifecycle, security deposit, lifecycle emails

Decisions from the user on 2026-09-25. They extend sections 1-10; where they conflict, this
section wins.

### 11.1 Lifecycle (authoritative order)

| Step | Stored status | Admin action | Email |
|---|---|---|---|
| Booking Submitted | `pending` | none | none |
| Payment Submitted | `pending` | none (customer) | none |
| Requirements Review | `pending` | approve/reject documents | none |
| Agreement | `pending` | countersign | none |
| Approved | `approved` | Approve (now gated, 11.4) | Approval email (result saved, sections 5-6) |
| Confirmed / Preparing | `confirmed` | Confirm (or auto-confirm) | none |
| Ready for Pickup | `ready_for_release` | Ready for Handover | **Ready for Pickup** email |
| Balance & Security Deposit | `ready_for_release` | record balance + record deposit | none |
| Picked Up | `released` | Mark as Picked Up | **Picked Up** email |
| Active Rental | `released` | none | none |
| Return Reminder | `released` | automatic job, or manual send | **Return Reminder** email |
| Returned | `released` | Mark as returned | **Returned** email |
| Inspection | `released` | Item Condition | none |
| Charges / Deposit Resolution | `released` | charges + Resolve Deposit | none |
| Completed | `returned` (shown "Completed") | Complete Rental | **Rental Completed** email (includes deposit outcome) |

Real facts checked on 2026-09-25 (live DB, read-only): all 17 products have deposit 0, and no
booking has a non-zero `deposit_total`. Taking the deposit out of the booking total therefore
changes no existing total, balance, payment or receipt.

### 11.2 Security deposit

- PHP 1,000 per rented device (`SECURITY_DEPOSIT_PER_DEVICE`), refundable. Required amount =
  1,000 x the sum of `booking_items.quantity`. It is stored on the deposit row when collected.
- It is **separate from the rental payment**: `booking_totals.total_amount` no longer adds
  `deposit_total` (the column stays). Checkout, cart, product page, emails and PDFs show it
  as its own "Security deposit (refundable)" line, due before release and not part of the total.
- Statuses: Not Paid (no row) / Held / Refunded / Partially Deducted / Fully Deducted, in the
  new table `booking_security_deposits` (one row per booking). Admins read and write it through
  RPCs. Customers can read their own row.
- **Collect**: admin records it (Cash / GCash / Other, optional reference) while the booking is
  `confirmed` or `ready_for_release`. The amount is always the full required amount.
- **Release guard**: the existing release trigger also raises `SECURITY_DEPOSIT_REQUIRED` when a
  deposit is required and not Held. The pay-later flag never bypasses the deposit.
- **Resolve** (after the return is recorded and the condition is saved): unpaid, non-voided
  charges are covered from the deposit oldest first (`booking_charges.deposit_applied`). A fully
  covered charge becomes Paid with method `security_deposit`. The rest is refunded (refund
  method required when above 0). Status becomes Refunded / Partially Deducted / Fully
  Deducted. If charges are larger than the deposit, the uncovered part stays unpaid and is shown
  as "Customer still owes PHP X". It must be paid (or voided) before Complete Rental.
- A charge with `deposit_applied > 0` cannot be voided.
- Complete Rental also requires the deposit to be resolved when a Held deposit exists. Bookings
  released before this policy (no deposit row) are not blocked.
- The admin catalog "Non-refundable deposit" input is replaced by a read-only policy note. The
  `products.refundable_deposit` column and its values are kept.
- All customer-facing "non-refundable deposit" wording is corrected. Agreements already signed
  keep their frozen snapshot.

### 11.3 Lifecycle emails

- New kinds: `ready_for_pickup` (on `ready_for_release`), `picked_up` (on `released`, from
  either the PATCH route or the Pickup tab, only when the status actually changes),
  `return_reminder` (3 hours before `bookings.return_at`, once), `returned` (the first time the
  return is recorded).
- Every attempt is saved in `booking_email_events` (kind, sent/failed, recipient, time,
  who triggered it). They appear in Email History, and failed ones can be resent from there.
- Return reminder job: `POST /api/jobs/return-reminders`, protected by `CRON_SECRET`, run
  every 15 minutes by a small PM2 worker (`scripts/returnReminderWorker.mjs`). The Return tab
  also has "Send return reminder now".
- Emails never roll back a status change. A failure is saved and can be resent.

### 11.4 Other fixes

- Approve requires approved documents, a verified payment and a completed agreement (server
  and UI). The approval email's "what happens next" wording follows that.
- The automatic rejection when an admin opens a pending booking is removed. A pending booking
  with no documents shows "Pending Requirements". Rejection only happens by an explicit admin
  decision. The auto-reject route and helper are left in place but unused.
- Auto-confirm after payment verification also requires a verified birthday discount when one
  applies (same rule as manual Confirm).
- `INVENTORY_NOT_RESERVED` and `SECURITY_DEPOSIT_REQUIRED` get plain admin messages. The
  pay-later sentence is removed from the balance error message and the approval email.
