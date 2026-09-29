# Customer Service & Customer Retention — Design

Date: 2026-09-30
Status: Design approved with two revisions (2026-09-30). Next step: implementation plan. No code written yet.
Areas: Storefront support surfaces, `app/account/*`, `app/guest/bookings/*`, `app/admin/*`, `supabase/migrations/*`

## 1. Goal

Raise Customer Service and Customer Retention to the top rubric level without rebuilding what
already works. The site already has official support channels, an in-app support chat,
verified-rental reviews with moderation, a loyalty reward, and customer/admin notifications.
This design adds the five things that are genuinely missing:

1. **Structured support cases** (complaints) with category, message, attachments, a four-state
   status, timestamps, admin notes, and an append-only history — open to **both registered
   customers and verified guests**.
2. **Documented service recovery** — refund, replacement, credit toward a next rental, or
   reschedule — recorded by an admin, never automated.
3. **Post-rental satisfaction feedback** (CSAT), separate from the public product review.
4. **Retention and satisfaction metrics in admin**, computed only from real rows.
5. **Follow-up states** so admins can see which cases still need attention.

Nothing is deleted. Every existing flow keeps working.

## 2. Findings that shape the design (verified in code)

| Finding | Consequence |
|---|---|
| Guest bookings are owned by a real `auth.users` row with `is_anonymous = true`. `private.recover_guest_booking_access` re-points `bookings.customer_id` **and** `notifications.user_id` to the recovered session's uid (`20260823160730_recover_guest_booking_access.sql:96-109`). | **Guests need no separate case path.** Support cases key on `customer_id uuid references auth.users(id)` and reuse the same RLS predicate for guests and registered customers. The recovery function must additionally re-point `support_cases.customer_id`, exactly as it already does for notifications (§5.4). |
| In-app support chat already exists: `chat_conversations` (booking-linked, `open`/`closed`, RLS by participant) and `chat_messages`, with an admin inbox at `/admin/messages` (`20260926120000_in_app_messaging.sql`). `chat_conversations` has a **unique index per booking** and a **unique general conversation per customer**. | Chat stays as the free-form conversation channel and is **not** repurposed for complaints — its uniqueness constraints make a second case per booking impossible. Support cases are their own records, and the case detail screen links to the existing chat when a customer wants to talk live. |
| Reviews are already restricted to completed rentals: the route requires `booking.status = 'returned'`, requires the product to be in `booking_items`, and enforces one review per `booking_item_id` (`app/api/bookings/[bookingId]/review/route.ts:50-72`). Moderation is `pending`/`approved`/`rejected` with `moderated_at`/`moderated_by`. | **Verified-review gating is already correct and is not changed.** Review work is display and admin-visibility only: show the rental/product reference, date, and a verified-rental badge; keep admin actions to approve/reject; never edit customer text. |
| `returned` is the stored status meaning the rental is complete; there is no `completed` enum value (`2026-09-21-rental-fulfillment-design.md` §2). | CSAT eligibility and every "completed rentals" metric read `status = 'returned'`. |
| Loyalty is the 11th-rental ₱200 reward, derived from `count(bookings where customer_id = uid and status = 'returned')` — no points ledger (`src/lib/promotions.ts`, `src/lib/loyaltyOutcome.ts`). Progress already renders on `/account/bookings`. | Loyalty logic is **untouched**. Retention metrics read the same derivation, so admin and customer never disagree. Guests never earn loyalty; guest-facing screens omit it. |
| `public.notifications` (`user_id`, `notification_type`, `title`, `message`, `action_url`, `booking_id`, `is_read`, `read_at`, `expires_at`) and `public.admin_notifications` (`admin_user_id`, …) already exist and are RLS-separated so a customer cannot read an admin alert. | Support notifications reuse both tables. No new notification tables. |
| Email goes through Resend via `src/lib/server/emailTransport.ts`; `sendBookingStatusEmail` never throws and uses an idempotency key. The Rental Completed email already exists (`src/lib/server/rentalCompletedEmail.ts`). | Support emails reuse the transport. The CSAT invitation is a **link added to the existing Rental Completed email**, not a new email. |
| Private-file pattern established: `booking-documents` bucket, uploaded server-side with the service client, read back through signed URLs (`src/lib/server/customerDocuments.ts`, `src/lib/supabase/storage.ts`). | Case attachments use a new **private** `support-attachments` bucket following the same pattern. No public URLs. |
| The official channels (TikTok `@iosrental.maddycassy`, email `iosrentalbymaddycassy@gmail.com`, Facebook page) are hard-coded in `app/contact/page.tsx` and duplicated in `components/navbar/Navbar.tsx` and `components/footer/SiteFooter.tsx`. | Extract to one module so every surface shows the same details (§4.1). The three channels stay exactly as they are. |
| The business publishes a **9:00 AM – 7:00 PM service window** for pickup and delivery appointments (`app/terms/page.tsx:33`, `components/reservation/PickupTimeSelector.tsx:195`). It has **not** committed to any response-time standard. | Operating hours are published as operating hours. **No response-time promise is published anywhere** — not "same-day", not "within 24 hours". Support screens state only verifiable facts: the channels, the operating window, and the case's own real timestamps. If the business later approves a response-time commitment, it is added in one place (§4.1). |
| Cancellation requests are the existing precedent for customer-initiated, admin-approved changes: a separate table, `pending`/`approved`/`rejected`, and a check constraint forcing `decided_by`/`decided_at` to be set together (`20260909172241_booking_cancellation_requests.sql`). | Support-case resolution follows the same shape: a resolution is a **record of an admin decision**, constrained so it cannot exist without an actor and a timestamp. |
| Tests are standalone `scripts/testX.ts` files run with `tsx --test` and chained in `npm run verify`. | New tests follow that convention and are added to `verify`. |
| The Supabase project for this app is not reachable from the current MCP connection. | Migrations are **written but not applied**. Given the prior `booking_payment_submissions` schema drift, §9 requires verifying the migration applies cleanly before the UI is exposed. |

## 3. Scope boundary

**In scope:** support cases (customer + guest + admin), attachments, case history, service-recovery
records, CSAT, support entry points, review display/visibility improvements, retention and
satisfaction metrics, support notifications, and the UI quality pass on those screens.

**Out of scope:** changing how reviews are gated or moderated, changing loyalty rules or amounts,
changing booking statuses, changing payments, replacing the existing chat, and any automatic
financial mutation.

## 4. Customer-facing design

### 4.1 One source of truth for support information

New `src/lib/support/supportChannels.ts` exports:

- `SUPPORT_CHANNELS` — the three existing channels (label, handle, href, description), moved
  verbatim from `app/contact/page.tsx`.
- `SERVICE_WINDOW` — `"9:00 AM – 7:00 PM"`, the already-published appointment window, with a
  comment pointing at `app/terms/page.tsx` as its source.
- `SUPPORT_RESPONSE_STANDARD` — **`null`**. A single named constant that is deliberately empty
  because the business has not committed to a response time. Every surface renders a
  response-time line only when this is non-null, so approving a standard later is a one-line
  change and no screen can invent one in the meantime.

`app/contact/page.tsx`, `components/navbar/Navbar.tsx`, and `components/footer/SiteFooter.tsx` are
refactored to read from this module. Their rendered output is unchanged apart from the contact
page gaining the operating-window line.

### 4.2 Support entry points

A shared `components/support/SupportHelpCallout.tsx` renders the channels plus, when the viewer
can open a case, a "Report a problem" action. It appears on:

| Surface | Entry |
|---|---|
| Header and footer | Existing Contact link (unchanged) |
| `/account` navigation | New **Support** item linking to `/account/support` |
| `/account/bookings/[bookingId]` | "Report a problem with this rental" — opens the form with this booking pre-selected; if the booking already has cases, they are listed with status chips |
| `/guest/bookings/[bookingId]` | Same, for the verified guest booking |
| Error and empty states | The callout is rendered in the booking-not-found, payment-failure, and empty-list states so a stuck customer always has a way out |

### 4.3 Filing a case

Form fields: **category** (required), **booking** (required for guests, optional for registered
customers), **subject**, **message** (10–2000 chars), **attachments** (optional, up to 5 files,
images and PDF, 10 MB each).

Categories: `booking_issue`, `payment_issue`, `item_condition`, `delivery_pickup`,
`account_access`, `other`.

On submit the case is created with status `open`, and the customer sees a confirmation carrying
the case reference and the real `created_at` timestamp — no predicted reply time.

### 4.4 Case thread

`/account/support` lists the customer's cases (reference, subject, category, status chip, last
update, unread indicator). `/account/support/[caseId]` shows the append-only timeline: customer
messages, admin replies, status changes, and the resolution. The customer can reply while the
case is `open`, `in_progress`, or `resolved`; a `closed` case is read-only with a "Start a new
request" action.

**Internal admin notes never appear here.** They are excluded by RLS *and* by the API projection,
so neither a policy change nor a route bug alone can leak one.

Guests reach the same thread from their verified booking-tracking page; the route resolves the
case through the booking they have already verified, so no account is required.

### 4.5 Post-rental satisfaction

When a booking reaches `returned`, its detail page shows a single CSAT step: **How satisfied were
you with this rental?** (1–5) plus an optional comment. One response per booking, editable never,
private to the customer and admins. It sits beside — not inside — the existing
`CustomerReviewPanel`, and the screen explains the difference: the review is public and
per-product, the satisfaction rating is private and about the service.

The existing Rental Completed email gains a link to this step. No new email is introduced.

## 5. Data model

All new objects live in one migration, `supabase/migrations/20260930090000_support_cases_and_feedback.sql`,
plus a second migration for the guest-recovery amendment (§5.4).

### 5.1 `public.support_cases`

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `case_reference` | text unique, `SC-` + 8 chars, generated like `booking_reference` |
| `customer_id` | uuid not null → `auth.users(id)` on delete cascade. Registered **or** anonymous guest user. |
| `booking_id` | uuid null → `bookings(id)` on delete set null |
| `category` | text, check against the six values in §4.3 |
| `subject` | text, 3–120 chars |
| `status` | text, check in (`open`, `in_progress`, `resolved`, `closed`), default `open` |
| `resolution_type` | text null, check in (`refund`, `replacement`, `credit`, `reschedule`, `other`) |
| `resolution_amount` | numeric(10,2) null — recorded only for `refund` and `credit` |
| `resolution_note` | text null |
| `resolved_by` / `resolved_at` | uuid null / timestamptz null |
| `closed_at` | timestamptz null |
| `first_admin_response_at` | timestamptz null — set once, on the first admin message |
| `last_customer_message_at` / `last_admin_message_at` | timestamptz null — drive follow-up states |
| `created_at` / `updated_at` | timestamptz not null default now() |

Constraints, mirroring the cancellation-request precedent:

- `status = 'resolved'` requires `resolution_type`, `resolution_note`, `resolved_by`, `resolved_at`
  all present; none of them may be set while status is `open` or `in_progress`.
- `resolution_amount` is null unless `resolution_type` in (`refund`, `credit`), and must be > 0
  when present.
- `status = 'closed'` requires `closed_at`.

### 5.2 `public.support_case_events` (append-only)

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `case_id` | uuid not null → `support_cases(id)` on delete cascade |
| `actor_role` | text, check in (`customer`, `admin`, `system`) |
| `actor_id` | uuid null → `auth.users(id)` on delete set null; null only for `system` |
| `event_type` | text, check in (`message`, `admin_note`, `status_change`, `resolution`) |
| `body` | text null, ≤ 2000 chars |
| `from_status` / `to_status` | text null — set for `status_change` and `resolution` |
| `is_internal` | boolean not null default false — true only for `admin_note` |
| `created_at` | timestamptz not null default now() |

Append-only is enforced, not merely intended: no `update` or `delete` grant is issued to
`authenticated`, and a `before update or delete` trigger raises
`SUPPORT_CASE_HISTORY_IMMUTABLE`. Conversation history therefore cannot be lost or rewritten.

A check constraint ties the shape together: `admin_note` implies `is_internal = true` and
`actor_role = 'admin'`; `message` implies `is_internal = false` and a non-empty body.

### 5.3 `public.support_case_attachments`

`id`, `case_id`, `event_id` (null for files attached at creation), `storage_path`, `file_name`,
`mime_type`, `size_bytes`, `uploaded_by`, `created_at`. Files live in a new **private**
`support-attachments` bucket with `file_size_limit` 10 MB and allowed MIME types
`image/jpeg`, `image/png`, `image/webp`, `application/pdf`. Reads go through an authorized route
that issues a short-lived signed URL after checking the caller owns the case or is an active
admin — the same shape as `app/api/account/verification-documents/preview/route.ts`.

### 5.4 Guest continuity amendment

`supabase/migrations/20260930091000_recover_guest_support_cases.sql` replaces
`private.recover_guest_booking_access` with an identical body plus one added block, placed
immediately after the existing `notifications` re-point:

```sql
update public.support_cases
set customer_id = v_uid, updated_at = now()
where booking_id = v_booking_id
  and customer_id = v_previous_customer_id;
```

Without this, a guest who recovers their booking into a new anonymous session would lose access to
a case they had already filed. Every other line of the function is preserved verbatim.

### 5.5 `public.booking_feedback`

`booking_id` (uuid pk → `bookings(id)` on delete cascade — one row per booking), `customer_id`,
`rating` smallint check between 1 and 5, `comment` text null ≤ 1000 chars, `created_at`.
Insert-only: no update or delete grant, so a satisfaction figure can never be revised after the
fact. Guests may submit feedback for their own verified completed booking.

### 5.6 RLS

- `support_cases`: select where `customer_id = auth.uid()` **or** `private.is_admin()`. No direct
  insert/update/delete grant to `authenticated` — all writes go through the RPCs in §6.
- `support_case_events`: select where the parent case belongs to the caller **and**
  `is_internal = false`, **or** `private.is_admin()`. Internal notes are invisible to customers at
  the row level.
- `support_case_attachments`: select mirrors the parent case; storage objects are reached only
  through the signed-URL route.
- `booking_feedback`: select where `customer_id = auth.uid()` or `private.is_admin()`; insert
  where the caller owns a booking whose status is `returned`.

## 6. RPCs

All `security definer`, `set search_path = ''`, following the existing migration style. Each one
writes its `support_case_events` row in the same transaction as the state change, so the case and
its history can never disagree.

| Function | Caller | Behaviour |
|---|---|---|
| `create_support_case(category, subject, message, booking_id)` | customer or guest | Verifies the booking (when given) belongs to the caller. Creates the case `open` + the first `message` event. Returns the case id and reference. |
| `add_support_case_message(case_id, body)` | customer, guest, or admin | Appends a `message` event. For an admin, sets `first_admin_response_at` if still null and updates `last_admin_message_at`; for a customer, updates `last_customer_message_at`. Rejected when the case is `closed`. |
| `add_support_case_note(case_id, body)` | admin only | Appends an internal `admin_note`. |
| `update_support_case_status(case_id, to_status)` | admin only | Allows `open → in_progress`, `in_progress → open`, `resolved → in_progress` (reopen), and `resolved → closed`. Appends a `status_change` event carrying both statuses. Moving to `resolved` is **not** permitted here. |
| `resolve_support_case(case_id, resolution_type, resolution_note, resolution_amount)` | admin only | The only path to `resolved`. Requires a note; requires an amount for `refund`/`credit` and forbids it otherwise. Stamps `resolved_by`/`resolved_at` and appends a `resolution` event. |

`resolve_support_case` records a decision and nothing else. It never writes to `bookings`,
`payments`, `promotions`, or any balance. A refund, replacement, credit, or reschedule is carried
out by the admin through the existing flows; the case stores the documentation of what was agreed.

## 7. Admin design

### 7.1 `/admin/support`

A case inbox listing reference, customer, booking, category, status, and last activity, with
filters for status, category, and **needs attention**. Selecting a case opens the full timeline —
customer messages, admin replies, internal notes, status changes, resolution — with actions to
reply, add an internal note, change status, and resolve. Internal notes are visually distinguished
as staff-only.

**Follow-up states** are derived at read time from real timestamps, never stored:

| State | Derivation |
|---|---|
| Needs first reply | `first_admin_response_at is null` and status is `open` |
| Awaiting admin reply | `last_customer_message_at > coalesce(last_admin_message_at, created_at)` |
| Open over 48 hours | status in (`open`, `in_progress`) and `created_at < now() - interval '48 hours'` |
| Resolved, awaiting close | status `resolved` and `resolved_at < now() - interval '7 days'` |

These thresholds describe **internal admin triage**, not a customer-facing promise, and are
labelled as such on screen.

### 7.2 Reviews and feedback

`/admin/reviews` keeps its approve/reject moderation and gains, per review: the product name, the
booking reference, the rental completion date, and a **Verified rental** badge justified by the
row's own booking link. Customer rating and comment remain read-only — the manager offers no edit
control, and no API accepts a change to `reviews.rating` or `reviews.comment`.

A second tab lists CSAT responses (rating, optional comment, booking reference, date), also
read-only.

### 7.3 Retention metrics

A retention panel computed entirely from existing rows:

| Metric | Source |
|---|---|
| Repeat customers | customers with ≥ 2 bookings at `status = 'returned'` |
| Completed rentals per customer | the same count, per customer, with the highest first |
| Loyalty progress | `src/lib/promotions.ts` constants against each customer's completed count — the identical derivation the customer sees |
| Review count | `reviews` grouped by status |
| Case count | `support_cases` grouped by status, plus the needs-attention total |
| Satisfaction | average and distribution over `booking_feedback` rows **that exist** |

Every tile states its denominator ("from 7 responses"). When a table is empty the tile shows an
explicit empty state — "No satisfaction responses yet" — and never a zero dressed up as a result.
No metric is estimated, extrapolated, or seeded.

## 8. Notifications

| Trigger | Customer | Admin |
|---|---|---|
| Case created | Confirmation with the case reference | `admin_notifications` row linking to the case |
| Customer replies | — | `admin_notifications` row |
| Admin replies | `notifications` row + email | — |
| Status changed | `notifications` row | — |
| Case resolved | `notifications` row + email carrying the resolution type and note | — |
| Booking completed | CSAT link inside the existing Rental Completed email | — |

Emails reuse `emailTransport` and, like `sendBookingStatusEmail`, never throw: a failed email
leaves a logged failure and the in-app notification intact. Internal notes never generate a
customer notification.

## 9. Testing and verification

New `scripts/testSupportCases.ts` and `scripts/testRetentionMetrics.ts`, run with `tsx --test` and
added to `npm run verify`, covering pure logic with no database dependency:

- status transition rules, including that `resolved` is unreachable except through
  `resolve_support_case`, and that a `closed` case rejects new messages;
- resolution validation — note required, amount required for `refund`/`credit` and forbidden
  otherwise;
- the customer-visible event projection excludes `is_internal` events;
- follow-up-state derivation against fixed timestamps;
- CSAT eligibility: `returned` only, once per booking, owner only;
- retention aggregation over fixtures, including the empty case, and loyalty progress matching
  `getLoyaltyEmailOutcome` for the same input.

Plus `npm run lint`, `tsc --noEmit`, and `next build`.

**Migration safety.** The migrations are written but **not applied**. Before the support UI is
exposed, the migration is applied to the Supabase project and `support_cases`,
`support_case_events`, `support_case_attachments`, and `booking_feedback` are confirmed present
with their constraints — the payments schema drift is the reason this check is explicit rather
than assumed.

## 10. UI quality pass

Delivered through `ui-ux-pro-max:ui-styling`, staying inside the existing system: Poppins, the
pink/cream palette, CSS modules alongside each component as the codebase already does.

Applies to every screen this design touches: labelled inputs with inline validation and error text
tied by `aria-describedby`, status chips that carry a text label rather than colour alone, live
regions for async results, visible focus rings, keyboard-reachable timelines and filters, real
empty and error states, and layouts verified at mobile width. Status colours meet WCAG AA contrast
against the cream background.

## 11. What is explicitly not built

- No response-time promise, anywhere, until the business approves one (§4.1).
- No automatic refund, credit, replacement, or reschedule. Resolutions are records of admin
  decisions (§6).
- No fabricated cases, reviews, satisfaction ratings, response times, or loyalty activity. Every
  figure in §7.3 comes from a real row, and empty means empty.
- No edit path for customer review text or CSAT responses.
- No change to review gating, loyalty rules, booking statuses, payments, or the existing chat.
- Nothing deleted.
