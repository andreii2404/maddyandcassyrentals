# Rental Fulfillment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a booking is approved and its confirmation email is sent, replace the review tabs with a Rental Fulfillment workflow (Pickup, Return, Item Condition, Charges & Payments, Customer Updates, Complete Rental) ending in a guarded, idempotent completion plus a Rental Completed email.

**Architecture:** Pure, unit-tested logic lives in `src/lib` (fulfillment rules, loyalty outcome, email builders). An additive Supabase migration adds email-tracking columns, three tables, a photo bucket and SECURITY DEFINER RPCs. Next.js admin API routes call the RPCs and send emails through one shared transport. `AdminBookingDetail` switches to a new `components/admin/fulfillment/*` UI when the gate passes; the old review UI stays untouched for other bookings.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase (Postgres, RLS, Storage), Resend (email), `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-21-rental-fulfillment-design.md`

**Addendum (2026-09-25):** `docs/superpowers/plans/2026-09-25-lifecycle-addendum.md` adds Task A, Tasks 15-20 and Task 14 additions (security deposit, lifecycle emails, fixes). Execution order: Task A, Tasks 3-13 here, Tasks 15-20, then Task 14.

## Global Constraints

- `returned` stays the stored booking status; show it as "Completed" in UI and emails. No enum change.
- Pickup uses the existing `released` transition; the existing balance-before-handover trigger is never bypassed.
- Loyalty uses the existing rule only: constants from `src/lib/promotions.ts` (`LOYALTY_REWARD_RENTAL_NUMBER`, `COMPLETED_RENTALS_BEFORE_REWARD`, `LOYALTY_REWARD_DISCOUNT`). Never hardcode a reward amount or threshold. Guests get no loyalty section. No loyalty write is added.
- Charges: type Late Fee / Damage Fee / Other; admin types every amount; payment Unpaid/Paid; method Cash/GCash/Other; void, never delete.
- Additive migration only. Do not delete or rewrite existing bookings, payments, documents, agreement files, loyalty history or customers.
- Customer-facing wording is simple and friendly. Match the Maddy & Cassy theme and Poppins (CSS variables from `app/globals.css`).
- No arrows (glyph or icon) and no live-update indicators in any new UI.
- Do not touch files with uncommitted user work: `app/admin/calendar/*`, `components/ui/Modal.*`, `components/admin/BookingFilePreview.*`, `src/lib/bookingFiles.ts`.
- Applying the migration to the live Supabase project needs the user's explicit go-ahead (Task 14). Never apply it silently.

## Decisions made while planning (flag to the user at handoff)

1. **Gate extension:** Fulfillment mode is also on for `released` and `returned` bookings regardless of email status. Otherwise a booking whose approval email failed but was handed over could never be completed (the old "Complete Return" action is blocked in Task 5).
2. **Apply the migration before deploying the app.** `getFulfillmentData` returns `available: false` when the new columns are missing, so the old UI keeps working, but the old "Complete Return" is blocked by Task 5 until the migration exists.
3. **Legacy backfill** sets `approval_email_status = 'legacy'` on rows that already have `approved_at`. It only fills a new column. The release-guard trigger fires on `update of status` only, so it does not fire.
4. **Cancel Booking** stays reachable from the Pickup tab (statuses before `released`), since the old Final Review actions are hidden.
5. **Charge reasons are internal.** Emails show only the charge type label, never the admin reason.
6. **RPC behavior is verified manually** (Task 14). The repo's tests cannot reach the database.
7. **Customer update rows are their own audit trail**; the service role writes them and they are not logged separately.

## File Structure

| File | Responsibility |
|---|---|
| `src/types/fulfillment.ts` (new) | Domain types, `EMPTY_FULFILLMENT_DATA`, `FulfillmentPanelContext` |
| `src/lib/rentalFulfillment.ts` (new) | Pure rules: gate, amounts owed, completion blockers, follow-up items, photo validation, email history |
| `src/lib/loyaltyOutcome.ts` (new) | Pure loyalty outcome for the completion email |
| `src/lib/emailShell.ts` (new) | Shared HTML shell and escaping for new emails |
| `src/lib/rentalCompletedEmailContent.ts` (new) | Rental Completed email builder |
| `src/lib/customerUpdateEmailContent.ts` (new) | Customer Update email builder (also used for preview) |
| `src/lib/fulfillmentApiHelpers.ts` (new) | Pure: RPC error mapping, uuid/date/text parsing |
| `src/lib/fulfillmentMappers.ts` (new) | Pure: DB rows to domain types |
| `supabase/migrations/20260921120000_rental_fulfillment.sql` (new) | Columns, tables, RLS, bucket, RPCs |
| `src/lib/supabase/database.types.ts` (modify) | Hand-added table, column and function types |
| `src/lib/supabase/storage.ts` (modify) | `conditionPhotos` bucket constant |
| `src/lib/server/emailTransport.ts` (new) | Generic Resend send (extracted) |
| `src/lib/server/bookingStatusEmail.ts` (modify) | Delegates to the transport, behavior preserved |
| `src/lib/server/bookingApprovalEmail.ts` (modify) | Records the approval email outcome on the booking |
| `src/lib/server/bookingRecipient.ts` (new) | Resolve the recipient email |
| `src/lib/server/rentalCompletedEmail.ts` (new) | Load data, send and record the completion email |
| `src/lib/server/customerUpdateEmail.ts` (new) | Deliver a stored customer update |
| `src/lib/server/fulfillmentServer.ts` (new) | Load completion inputs on the server |
| `app/api/admin/bookings/[bookingId]/...` (new/modify) | fulfillment, charges, customer-updates, complete, completion-email routes; PATCH guard |
| `src/services/fulfillmentService.ts` (new) | Client data loader, action callers, photo upload |
| `components/admin/fulfillment/*` (new) | Tab panels, shell, follow-up strip, record view, CSS module |
| `app/admin/bookings/[bookingId]/AdminBookingDetail.tsx` (modify) | Gate and render the fulfillment UI |
| `components/status-badge/StatusBadge.tsx` (modify) | "Returned" label becomes "Completed" |
| `scripts/testRentalFulfillment.ts`, `scripts/testFulfillmentEmails.ts` (new) | Unit tests |
| `package.json` (modify) | `test:fulfillment` script, added to `verify` |

---

### Task 1: Domain types and pure fulfillment rules

**Files:**
- Create: `src/types/fulfillment.ts`
- Create: `src/lib/rentalFulfillment.ts`
- Create: `scripts/testRentalFulfillment.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces (used by every later task):
  - `isFulfillmentMode(input: { status: BookingStatus; approvalEmailStatus: ApprovalEmailStatus }): boolean`
  - `computeAmountOwed(input: { totalAmount: number; verifiedPaid: number; charges: BookingCharge[] }): { bookingBalance: number; unpaidCharges: number; totalOwed: number }`
  - `activeCharges(charges: BookingCharge[]): BookingCharge[]`
  - `getCompletionBlockers(input: CompletionInput): string[]`
  - `getFollowUpItems(input: FollowUpInput): FollowUpItem[]`
  - `validateConditionPhoto(file: { type: string; size: number }): string | null`
  - `buildEmailHistory(input): EmailHistoryEntry[]`
  - `formatPhp(value: number): string`
  - constants `CHARGE_TYPE_LABELS`, `CHARGE_METHOD_LABELS`, `PAYMENT_AWAITING_REVIEW_STATUSES`, `MAX_CONDITION_PHOTOS`

- [ ] **Step 1: Create the domain types**

Create `src/types/fulfillment.ts`:

```ts
import type { BookingStatus } from "@/src/types/booking";

export type ApprovalEmailStatus = "sent" | "failed" | "legacy" | null;
export type ItemCondition = "good" | "damaged";
export type ChargeType = "late_fee" | "damage_fee" | "other";
export type ChargePaymentMethod = "cash" | "gcash" | "other";

export interface BookingEmailState {
  approvalEmailStatus: ApprovalEmailStatus;
  approvalEmailSentAt?: string;
  completionEmailSentAt?: string;
  completionEmailTo?: string;
}

export interface FulfillmentRecord {
  bookingId: string;
  pickedUp: boolean;
  actualPickupAt?: string;
  pickupNotes?: string;
  returned: boolean;
  actualReturnAt?: string;
  returnNotes?: string;
  itemCondition: ItemCondition | null;
  conditionNotes?: string;
  conditionPhotoPaths: string[];
  updatedAt: string;
}

export interface BookingCharge {
  id: string;
  bookingId: string;
  chargeType: ChargeType;
  amount: number;
  reason: string;
  paymentStatus: "unpaid" | "paid";
  paymentMethod?: ChargePaymentMethod;
  paidAt?: string;
  paidRecordedBy?: string;
  createdBy?: string;
  createdAt: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

export interface CustomerUpdate {
  id: string;
  bookingId: string;
  subject: string;
  message: string;
  sentTo?: string;
  sentBy?: string;
  adminNote?: string;
  relatedChargeId?: string;
  deliveryStatus: "sent" | "failed";
  deliveryAttempts: number;
  firstAttemptAt?: string;
  lastAttemptAt?: string;
  sentAt?: string;
  createdAt: string;
}

export interface FulfillmentData {
  /** False when the fulfillment tables/columns are not available yet; the old review UI is used. */
  available: boolean;
  email: BookingEmailState;
  record: FulfillmentRecord | null;
  charges: BookingCharge[];
  updates: CustomerUpdate[];
  /** Admin user id to display name, for "recorded by" labels. */
  adminNames: Record<string, string>;
}

export const EMPTY_FULFILLMENT_DATA: FulfillmentData = {
  available: false,
  email: { approvalEmailStatus: null },
  record: null,
  charges: [],
  updates: [],
  adminNames: {},
};

/** Everything a fulfillment tab panel needs about the booking. */
export interface FulfillmentPanelContext {
  bookingId: string;
  bookingRef: string;
  status: BookingStatus;
  customerName: string;
  customerEmail: string;
  isGuest: boolean;
  totalAmount: number;
  verifiedPaid: number;
  pendingPaymentReviews: number;
  payLaterAllowed: boolean;
  /** True when the balance is paid or a pay-later exception is approved (mirrors the handover guard). */
  handoverPaymentReady: boolean;
  releasedAt?: string;
  data: FulfillmentData;
  /** Reloads the booking page data after a change. */
  onChanged: () => Promise<void>;
}
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/testRentalFulfillment.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  activeCharges,
  buildEmailHistory,
  computeAmountOwed,
  getCompletionBlockers,
  getFollowUpItems,
  isFulfillmentMode,
  validateConditionPhoto,
} from "../src/lib/rentalFulfillment";
import type { BookingCharge } from "../src/types/fulfillment";

function charge(overrides: Partial<BookingCharge> = {}): BookingCharge {
  return {
    id: "charge-1",
    bookingId: "booking-1",
    chargeType: "late_fee",
    amount: 500,
    reason: "Returned late",
    paymentStatus: "unpaid",
    createdAt: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

test("fulfillment mode needs approval plus a sent or legacy email", () => {
  assert.equal(isFulfillmentMode({ status: "approved", approvalEmailStatus: "sent" }), true);
  assert.equal(isFulfillmentMode({ status: "approved", approvalEmailStatus: "legacy" }), true);
  assert.equal(isFulfillmentMode({ status: "approved", approvalEmailStatus: "failed" }), false);
  assert.equal(isFulfillmentMode({ status: "approved", approvalEmailStatus: null }), false);
  assert.equal(isFulfillmentMode({ status: "pending", approvalEmailStatus: "sent" }), false);
  assert.equal(isFulfillmentMode({ status: "cancelled", approvalEmailStatus: "sent" }), false);
});

test("released and completed bookings always use fulfillment mode", () => {
  assert.equal(isFulfillmentMode({ status: "released", approvalEmailStatus: "failed" }), true);
  assert.equal(isFulfillmentMode({ status: "returned", approvalEmailStatus: null }), true);
});

test("voided charges never count toward what is owed", () => {
  const charges = [
    charge({ id: "a", amount: 500 }),
    charge({ id: "b", amount: 300, paymentStatus: "paid", paymentMethod: "cash", paidAt: "2026-09-21T01:00:00.000Z" }),
    charge({ id: "c", amount: 900, voidedAt: "2026-09-21T02:00:00.000Z", voidReason: "Entered by mistake" }),
  ];
  assert.deepEqual(activeCharges(charges).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(computeAmountOwed({ totalAmount: 2500, verifiedPaid: 2000, charges }), {
    bookingBalance: 500,
    unpaidCharges: 500,
    totalOwed: 1000,
  });
});

test("nothing is owed when the booking and every charge are paid", () => {
  const owed = computeAmountOwed({
    totalAmount: 2500,
    verifiedPaid: 2500,
    charges: [charge({ paymentStatus: "paid", paymentMethod: "gcash", paidAt: "2026-09-21T01:00:00.000Z" })],
  });
  assert.equal(owed.totalOwed, 0);
});

test("overpayment never produces a negative balance", () => {
  assert.equal(computeAmountOwed({ totalAmount: 1000, verifiedPaid: 1200, charges: [] }).bookingBalance, 0);
});

const readyToComplete = {
  status: "released" as const,
  returned: true,
  itemCondition: "good" as const,
  charges: [],
  totalAmount: 2500,
  verifiedPaid: 2500,
  pendingPaymentReviews: 0,
};

test("a rental that meets every rule has no completion blockers", () => {
  assert.deepEqual(getCompletionBlockers(readyToComplete), []);
});

test("each unmet rule adds a plain blocker message", () => {
  const blockers = getCompletionBlockers({
    ...readyToComplete,
    returned: false,
    itemCondition: null,
    charges: [charge({ amount: 500 })],
    verifiedPaid: 2000,
    pendingPaymentReviews: 2,
  });
  assert.equal(blockers.length, 5);
  assert.match(blockers.join(" "), /return/i);
  assert.match(blockers.join(" "), /condition/i);
  assert.match(blockers.join(" "), /PHP 500/);
  assert.match(blockers.join(" "), /2 payment/);
});

test("a rental that is not released cannot be completed", () => {
  assert.equal(getCompletionBlockers({ ...readyToComplete, status: "ready_for_release" }).length, 1);
  assert.match(getCompletionBlockers({ ...readyToComplete, status: "returned" })[0], /already completed/i);
});

test("follow-up items list only unfinished work", () => {
  const none = getFollowUpItems({
    status: "released",
    pendingPaymentReviews: 0,
    requirementsApproved: true,
    agreementStatus: "completed",
    canCountersign: false,
  });
  assert.deepEqual(none, []);

  const approved = getFollowUpItems({
    status: "approved",
    pendingPaymentReviews: 1,
    requirementsApproved: false,
    agreementStatus: "awaiting_business_signature",
    canCountersign: true,
  });
  assert.deepEqual(
    approved.map((item) => item.kind),
    ["payment_review", "documents", "countersign", "confirm_booking"],
  );
});

test("follow-up shows the customer-signature wait and the handover step", () => {
  const waiting = getFollowUpItems({
    status: "approved",
    pendingPaymentReviews: 0,
    requirementsApproved: true,
    agreementStatus: "awaiting_customer_signature",
    canCountersign: false,
  });
  assert.deepEqual(waiting.map((item) => item.kind), ["customer_signature", "confirm_booking"]);

  const confirmed = getFollowUpItems({
    status: "confirmed",
    pendingPaymentReviews: 0,
    requirementsApproved: true,
    agreementStatus: "completed",
    canCountersign: false,
  });
  assert.deepEqual(confirmed.map((item) => item.kind), ["ready_for_handover"]);
});

test("condition photos must be small images", () => {
  assert.equal(validateConditionPhoto({ type: "image/jpeg", size: 1024 }), null);
  assert.match(validateConditionPhoto({ type: "application/pdf", size: 1024 }) ?? "", /JPG, PNG or WebP/);
  assert.match(validateConditionPhoto({ type: "image/png", size: 6 * 1024 * 1024 }) ?? "", /5 MB/);
});

test("email history merges approval, receipt, update and completion emails newest first", () => {
  const history = buildEmailHistory({
    email: {
      approvalEmailStatus: "sent",
      approvalEmailSentAt: "2026-09-20T00:00:00.000Z",
      completionEmailSentAt: "2026-09-25T00:00:00.000Z",
      completionEmailTo: "a@example.com",
    },
    receipts: [{ id: "r1", receiptNumber: "RC-1", emailedAt: "2026-09-21T00:00:00.000Z" }],
    updates: [
      {
        id: "u1",
        bookingId: "b",
        subject: "Damage notice",
        message: "m",
        deliveryStatus: "failed",
        deliveryAttempts: 1,
        createdAt: "2026-09-22T00:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(history.map((entry) => entry.key), ["completion", "update-u1", "receipt-r1", "approval"]);
  assert.equal(history[1].result, "Not sent");
});

test("a legacy approval email shows as unavailable", () => {
  const history = buildEmailHistory({
    email: { approvalEmailStatus: "legacy" },
    receipts: [],
    updates: [],
  });
  assert.equal(history[0].result, "Unavailable");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsx --test scripts/testRentalFulfillment.ts`
Expected: FAIL with "Cannot find module '../src/lib/rentalFulfillment'".

- [ ] **Step 4: Implement the rules**

Create `src/lib/rentalFulfillment.ts`:

```ts
import type { BookingStatus } from "@/src/types/booking";
import type {
  ApprovalEmailStatus,
  BookingCharge,
  BookingEmailState,
  ChargePaymentMethod,
  ChargeType,
  CustomerUpdate,
} from "@/src/types/fulfillment";

export const FULFILLMENT_STATUSES: BookingStatus[] = [
  "approved",
  "confirmed",
  "ready_for_release",
  "released",
  "returned",
];

/** Payment submission statuses that still need an admin decision. */
export const PAYMENT_AWAITING_REVIEW_STATUSES = ["submitted", "under_review"] as const;

export const CHARGE_TYPE_LABELS: Record<ChargeType, string> = {
  late_fee: "Late Fee",
  damage_fee: "Damage Fee",
  other: "Other",
};

export const CHARGE_METHOD_LABELS: Record<ChargePaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  other: "Other",
};

export const MAX_CONDITION_PHOTOS = 6;
export const MAX_CONDITION_PHOTO_BYTES = 5 * 1024 * 1024;
export const CONDITION_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

const round2 = (value: number) => Math.round(value * 100) / 100;

export function formatPhp(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * The Rental Fulfillment view replaces the review tabs once the booking is approved and its
 * confirmation email went out. Older approvals ("legacy") open it without a resend. Handed-over
 * and completed bookings always use it so a failed approval email can never strand a rental.
 */
export function isFulfillmentMode(input: {
  status: BookingStatus;
  approvalEmailStatus: ApprovalEmailStatus;
}): boolean {
  if (input.status === "released" || input.status === "returned") return true;
  if (!FULFILLMENT_STATUSES.includes(input.status)) return false;
  return input.approvalEmailStatus === "sent" || input.approvalEmailStatus === "legacy";
}

export function activeCharges(charges: BookingCharge[]): BookingCharge[] {
  return charges.filter((charge) => !charge.voidedAt);
}

export function computeAmountOwed(input: {
  totalAmount: number;
  verifiedPaid: number;
  charges: BookingCharge[];
}): { bookingBalance: number; unpaidCharges: number; totalOwed: number } {
  const rawBalance = round2(input.totalAmount - input.verifiedPaid);
  const bookingBalance = rawBalance < 0.01 ? 0 : rawBalance;
  const unpaidCharges = round2(
    activeCharges(input.charges)
      .filter((charge) => charge.paymentStatus !== "paid")
      .reduce((sum, charge) => sum + charge.amount, 0),
  );
  return { bookingBalance, unpaidCharges, totalOwed: round2(bookingBalance + unpaidCharges) };
}

export interface CompletionInput {
  status: BookingStatus;
  returned: boolean;
  itemCondition: "good" | "damaged" | null;
  charges: BookingCharge[];
  totalAmount: number;
  verifiedPaid: number;
  pendingPaymentReviews: number;
}

/** Plain-language reasons a rental cannot be completed yet. Empty means it can be. */
export function getCompletionBlockers(input: CompletionInput): string[] {
  if (input.status === "returned") return ["This rental is already completed."];
  if (input.status !== "released") return ["The item must be marked as picked up first."];

  const blockers: string[] = [];
  if (!input.returned) blockers.push("Record the item return in the Return tab.");
  if (!input.itemCondition) blockers.push("Record the item condition in the Item Condition tab.");

  const owed = computeAmountOwed({
    totalAmount: input.totalAmount,
    verifiedPaid: input.verifiedPaid,
    charges: input.charges,
  });
  if (owed.unpaidCharges > 0) {
    blockers.push(`Extra charges of ${formatPhp(owed.unpaidCharges)} are still unpaid. Mark them paid or void them.`);
  }
  if (owed.bookingBalance > 0) {
    blockers.push(`The booking still has a balance of ${formatPhp(owed.bookingBalance)}.`);
  }
  if (input.pendingPaymentReviews > 0) {
    blockers.push(
      `${input.pendingPaymentReviews} payment proof${input.pendingPaymentReviews === 1 ? " still needs" : "s still need"} review.`,
    );
  }
  return blockers;
}

export type FollowUpKind =
  | "payment_review"
  | "documents"
  | "customer_signature"
  | "countersign"
  | "confirm_booking"
  | "ready_for_handover";

export interface FollowUpItem {
  kind: FollowUpKind;
  title: string;
  detail: string;
}

export interface FollowUpInput {
  status: BookingStatus;
  pendingPaymentReviews: number;
  requirementsApproved: boolean;
  agreementStatus: string;
  canCountersign: boolean;
}

/**
 * Only unfinished items. When this returns an empty list the follow-up strip is removed
 * entirely (no "all done" placeholder).
 */
export function getFollowUpItems(input: FollowUpInput): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  const activeStatus =
    input.status === "approved" ||
    input.status === "confirmed" ||
    input.status === "ready_for_release" ||
    input.status === "released";

  if (input.pendingPaymentReviews > 0 && activeStatus) {
    items.push({
      kind: "payment_review",
      title: "Payment proof needs review",
      detail: `${input.pendingPaymentReviews} payment proof${input.pendingPaymentReviews === 1 ? " is" : "s are"} waiting for a decision.`,
    });
  }

  if (input.status === "approved") {
    if (!input.requirementsApproved) {
      items.push({
        kind: "documents",
        title: "Verification documents need review",
        detail: "Every required document must be approved before the booking can be confirmed.",
      });
    }
    if (input.agreementStatus === "not_created" || input.agreementStatus === "awaiting_customer_signature") {
      items.push({
        kind: "customer_signature",
        title: "Waiting for the customer to sign",
        detail: "The rental agreement is not signed by the customer yet.",
      });
    }
    if (input.canCountersign) {
      items.push({
        kind: "countersign",
        title: "Agreement needs your signature",
        detail: "The customer has signed. Countersign to finish the agreement.",
      });
    }
    items.push({
      kind: "confirm_booking",
      title: "Confirm the booking",
      detail: "Confirm once payment, documents and the agreement are complete.",
    });
  }

  if (input.status === "confirmed") {
    items.push({
      kind: "ready_for_handover",
      title: "Mark the rental ready for handover",
      detail: "Let the customer know the rental is prepared for pickup or delivery.",
    });
  }

  return items;
}

/** Returns a plain message when the file cannot be used, otherwise null. */
export function validateConditionPhoto(file: { type: string; size: number }): string | null {
  if (!CONDITION_PHOTO_TYPES.includes(file.type)) return "Photos must be JPG, PNG or WebP images.";
  if (file.size > MAX_CONDITION_PHOTO_BYTES) return "Each photo must be 5 MB or smaller.";
  return null;
}

export interface EmailHistoryEntry {
  key: string;
  label: string;
  at?: string;
  result: "Sent" | "Not sent" | "Unavailable";
  detail?: string;
}

export function buildEmailHistory(input: {
  email: BookingEmailState;
  receipts: { id: string; receiptNumber?: string; emailedAt?: string }[];
  updates: CustomerUpdate[];
}): EmailHistoryEntry[] {
  const entries: EmailHistoryEntry[] = [];

  const approval = input.email.approvalEmailStatus;
  if (approval === "sent") {
    entries.push({ key: "approval", label: "Booking approval email", at: input.email.approvalEmailSentAt, result: "Sent" });
  } else if (approval === "failed") {
    entries.push({ key: "approval", label: "Booking approval email", result: "Not sent" });
  } else if (approval === "legacy") {
    entries.push({
      key: "approval",
      label: "Booking approval email",
      result: "Unavailable",
      detail: "Confirmation email status unavailable",
    });
  }

  for (const receipt of input.receipts) {
    if (!receipt.emailedAt) continue;
    entries.push({
      key: `receipt-${receipt.id}`,
      label: `Receipt ${receipt.receiptNumber ?? receipt.id.slice(0, 8)}`,
      at: receipt.emailedAt,
      result: "Sent",
    });
  }

  for (const update of input.updates) {
    entries.push({
      key: `update-${update.id}`,
      label: `Customer update: ${update.subject}`,
      at: update.sentAt ?? update.createdAt,
      result: update.deliveryStatus === "sent" ? "Sent" : "Not sent",
    });
  }

  if (input.email.completionEmailSentAt) {
    entries.push({
      key: "completion",
      label: "Rental completed email",
      at: input.email.completionEmailSentAt,
      result: "Sent",
      detail: input.email.completionEmailTo,
    });
  }

  return entries.sort((a, b) => Date.parse(b.at ?? "0") - Date.parse(a.at ?? "0"));
}
```

- [ ] **Step 5: Add the test script**

In `package.json`, add this script after `"test:feedback"` and append `&& npm run test:fulfillment` to `verify` just before `&& npm run build`:

```json
    "test:fulfillment": "tsx --test scripts/testRentalFulfillment.ts scripts/testFulfillmentEmails.ts",
```

(The second file is created in Task 2; until then run the single-file command from Step 3.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx --test scripts/testRentalFulfillment.ts`
Expected: PASS, 13 tests.

- [ ] **Step 7: Commit**

```bash
git add src/types/fulfillment.ts src/lib/rentalFulfillment.ts scripts/testRentalFulfillment.ts package.json
git commit -m "feat: add rental fulfillment domain types and rules"
```

### Task 2: Loyalty outcome and email builders

**Files:**
- Create: `src/lib/loyaltyOutcome.ts`
- Create: `src/lib/emailShell.ts`
- Create: `src/lib/rentalCompletedEmailContent.ts`
- Create: `src/lib/customerUpdateEmailContent.ts`
- Create: `scripts/testFulfillmentEmails.ts`

**Interfaces:**
- Consumes: `LOYALTY_REWARD_DISCOUNT`, `LOYALTY_REWARD_RENTAL_NUMBER`, `COMPLETED_RENTALS_BEFORE_REWARD` from `src/lib/promotions.ts`.
- Produces:
  - `getLoyaltyEmailOutcome(input: { isGuest: boolean; completedRentals: number; loyaltyRewardUsed: boolean; thisBookingRewardAmount: number }): LoyaltyEmailOutcome`
  - `describeLoyaltyOutcome(outcome: LoyaltyEmailOutcome): string | null`
  - `buildRentalCompletedEmail(details: RentalCompletedEmailDetails): { subject: string; html: string; text: string }`
  - `buildCustomerUpdateEmail(details: CustomerUpdateEmailDetails): { subject: string; html: string; text: string }`
  - `escapeHtml(value: string): string`, `firstName(fullName: string): string`, `formatPeso(value: number): string`

- [ ] **Step 1: Write the failing tests**

Create `scripts/testFulfillmentEmails.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETED_RENTALS_BEFORE_REWARD,
  LOYALTY_REWARD_DISCOUNT,
} from "../src/lib/promotions";
import { describeLoyaltyOutcome, getLoyaltyEmailOutcome } from "../src/lib/loyaltyOutcome";
import { buildRentalCompletedEmail } from "../src/lib/rentalCompletedEmailContent";
import { buildCustomerUpdateEmail } from "../src/lib/customerUpdateEmailContent";

const account = { isGuest: false, loyaltyRewardUsed: false, thisBookingRewardAmount: 0 };

test("guests never get a loyalty outcome", () => {
  assert.deepEqual(
    getLoyaltyEmailOutcome({ ...account, isGuest: true, completedRentals: 4 }),
    { kind: "none" },
  );
});

test("progress shows how many rentals remain, using the shared constants", () => {
  const outcome = getLoyaltyEmailOutcome({ ...account, completedRentals: 3 });
  assert.deepEqual(outcome, {
    kind: "progress",
    completedRentals: 3,
    rentalsUntilReward: COMPLETED_RENTALS_BEFORE_REWARD - 3,
  });
  const text = describeLoyaltyOutcome(outcome) ?? "";
  assert.match(text, new RegExp(`3 of ${COMPLETED_RENTALS_BEFORE_REWARD}`));
  assert.match(text, new RegExp(String(LOYALTY_REWARD_DISCOUNT)));
});

test("reaching the threshold unlocks the reward exactly once", () => {
  assert.deepEqual(
    getLoyaltyEmailOutcome({ ...account, completedRentals: COMPLETED_RENTALS_BEFORE_REWARD }),
    { kind: "reward_unlocked" },
  );
  assert.deepEqual(
    getLoyaltyEmailOutcome({ ...account, completedRentals: COMPLETED_RENTALS_BEFORE_REWARD + 2 }),
    { kind: "reward_available" },
  );
});

test("a used reward shows only when this rental used it", () => {
  assert.deepEqual(
    getLoyaltyEmailOutcome({
      ...account,
      completedRentals: COMPLETED_RENTALS_BEFORE_REWARD + 1,
      loyaltyRewardUsed: true,
      thisBookingRewardAmount: LOYALTY_REWARD_DISCOUNT,
    }),
    { kind: "reward_applied", discountAmount: LOYALTY_REWARD_DISCOUNT },
  );
  assert.deepEqual(
    getLoyaltyEmailOutcome({
      ...account,
      completedRentals: COMPLETED_RENTALS_BEFORE_REWARD + 5,
      loyaltyRewardUsed: true,
    }),
    { kind: "none" },
  );
  assert.equal(describeLoyaltyOutcome({ kind: "none" }), null);
});

const completed = {
  bookingId: "booking-1",
  bookingReference: "BK-100",
  customerName: "Ana Cruz",
  customerEmail: "ana@example.com",
  items: [{ name: "Canon R50", quantity: 1 }, { name: "Tripod", quantity: 2 }],
  completedAt: "2026-09-25T04:00:00.000Z",
  bookingUrl: "https://example.com/account/bookings/booking-1",
  isGuest: false,
  rentalTotal: 2500,
  charges: [{ label: "Late Fee", amount: 500 }],
  totalPaid: 3000,
  balance: 0,
  loyalty: { kind: "progress" as const, completedRentals: 4, rentalsUntilReward: 6 },
};

test("the completed email lists every required detail", () => {
  const email = buildRentalCompletedEmail(completed);
  for (const part of ["Ana", "BK-100", "Canon R50", "Tripod", "Sep 25, 2026", "Late Fee", "₱500", "₱3,000", "Thank you"]) {
    assert.ok(email.html.includes(part), `html is missing ${part}`);
    assert.ok(email.text.includes(part), `text is missing ${part}`);
  }
  assert.match(email.subject, /BK-100/);
  assert.match(email.html, /4 of/);
});

test("the completed email leaves out loyalty when there is nothing to report", () => {
  const email = buildRentalCompletedEmail({ ...completed, loyalty: { kind: "none" }, charges: [] });
  assert.ok(!/loyalty/i.test(email.html));
  assert.ok(!/loyalty/i.test(email.text));
});

test("the completed email escapes customer-controlled text", () => {
  const email = buildRentalCompletedEmail({ ...completed, customerName: "<b>Ana</b>", items: [{ name: "<i>Cam</i>", quantity: 1 }] });
  assert.ok(!email.html.includes("<b>Ana</b>"));
  assert.ok(!email.html.includes("<i>Cam</i>"));
});

test("a customer update keeps the admin's subject and escapes the message", () => {
  const email = buildCustomerUpdateEmail({
    bookingReference: "BK-100",
    customerName: "Ana Cruz",
    subject: "Damage notice",
    message: "We noticed damage.\n\n<script>alert(1)</script>",
    bookingUrl: "https://example.com/b",
    isGuest: false,
  });
  assert.equal(email.subject, "Damage notice");
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("We noticed damage."));
  assert.ok(email.text.includes("We noticed damage."));
});

test("a customer update can show the related charge", () => {
  const email = buildCustomerUpdateEmail({
    bookingReference: "BK-100",
    customerName: "Ana Cruz",
    subject: "Late fee",
    message: "Please prepare the late fee.",
    bookingUrl: "https://example.com/b",
    isGuest: false,
    charge: { label: "Late Fee", amount: 500, paid: false },
  });
  assert.ok(email.html.includes("Late Fee"));
  assert.ok(email.html.includes("₱500"));
  assert.ok(email.html.includes("Unpaid"));
  assert.ok(email.text.includes("Late Fee: ₱500 (Unpaid)"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test scripts/testFulfillmentEmails.ts`
Expected: FAIL with "Cannot find module '../src/lib/loyaltyOutcome'".

- [ ] **Step 3: Implement the loyalty outcome**

Create `src/lib/loyaltyOutcome.ts`:

```ts
import {
  COMPLETED_RENTALS_BEFORE_REWARD,
  LOYALTY_REWARD_DISCOUNT,
  LOYALTY_REWARD_RENTAL_NUMBER,
} from "@/src/lib/promotions";

export type LoyaltyEmailOutcome =
  | { kind: "none" }
  | { kind: "progress"; completedRentals: number; rentalsUntilReward: number }
  | { kind: "reward_unlocked" }
  | { kind: "reward_available" }
  | { kind: "reward_applied"; discountAmount: number };

/**
 * What the Rental Completed email should say about loyalty. It only reads the existing rule
 * (10 completed rentals unlock one reward for the 11th) and writes nothing: the count comes from
 * bookings already marked completed, so retrying a completion can never award anything twice.
 * `completedRentals` must already include the rental that was just completed.
 */
export function getLoyaltyEmailOutcome(input: {
  isGuest: boolean;
  completedRentals: number;
  loyaltyRewardUsed: boolean;
  /** Loyalty discount this booking itself received (0 when it did not use the reward). */
  thisBookingRewardAmount: number;
}): LoyaltyEmailOutcome {
  if (input.isGuest) return { kind: "none" };
  if (input.thisBookingRewardAmount > 0) {
    return { kind: "reward_applied", discountAmount: input.thisBookingRewardAmount };
  }
  if (input.loyaltyRewardUsed) return { kind: "none" };
  if (input.completedRentals > COMPLETED_RENTALS_BEFORE_REWARD) return { kind: "reward_available" };
  if (input.completedRentals === COMPLETED_RENTALS_BEFORE_REWARD) return { kind: "reward_unlocked" };
  if (input.completedRentals < 1) return { kind: "none" };
  return {
    kind: "progress",
    completedRentals: input.completedRentals,
    rentalsUntilReward: COMPLETED_RENTALS_BEFORE_REWARD - input.completedRentals,
  };
}

const peso = (value: number) => `₱${value.toLocaleString("en-PH")}`;

/** Customer-friendly sentence for the email, or null when there is nothing to say. */
export function describeLoyaltyOutcome(outcome: LoyaltyEmailOutcome): string | null {
  switch (outcome.kind) {
    case "none":
      return null;
    case "progress": {
      const remaining = outcome.rentalsUntilReward;
      return `You have completed ${outcome.completedRentals} of ${COMPLETED_RENTALS_BEFORE_REWARD} rentals. ${remaining} more rental${remaining === 1 ? "" : "s"} to go before your ${peso(LOYALTY_REWARD_DISCOUNT)} loyalty reward on rental number ${LOYALTY_REWARD_RENTAL_NUMBER}.`;
    }
    case "reward_unlocked":
      return `Congratulations! You have unlocked a ${peso(LOYALTY_REWARD_DISCOUNT)} loyalty reward. It will be applied automatically to your next booking.`;
    case "reward_available":
      return `Your ${peso(LOYALTY_REWARD_DISCOUNT)} loyalty reward is still waiting. It will be applied automatically to your next booking.`;
    case "reward_applied":
      return `Your ${peso(outcome.discountAmount)} loyalty reward was applied to this rental. Thank you for being a loyal renter!`;
  }
}
```

- [ ] **Step 4: Implement the shared email shell**

Create `src/lib/emailShell.ts` (same look as the existing status email in `bookingStatusEmailContent.ts`, which stays unchanged):

```ts
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

export function formatPeso(value: number): string {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatManilaDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Two-column label/value rows. Values may contain newlines. Rows without a value are skipped. */
export function renderSummaryTable(rows: [string, string | undefined][]): string {
  const visible = rows.filter((row): row is [string, string] => Boolean(row[1]));
  if (!visible.length) return "";
  const body = visible
    .map(
      ([label, value]) =>
        `<tr><td valign="top" style="padding:7px 12px 7px 0;color:#8b7d80;font-size:12px;font-weight:700;letter-spacing:.8px;text-transform:uppercase">${escapeHtml(label)}</td><td align="right" style="padding:7px 0;color:#292425;font-size:14px;font-weight:700">${escapeHtml(value).replaceAll("\n", "<br>")}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf8;border:1px solid #f0e4e0;border-radius:16px"><tr><td style="padding:14px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr></table>`;
}

interface EmailShellInput {
  preheader: string;
  eyebrow: string;
  heading: string;
  /** Already-escaped HTML. */
  introHtml: string;
  /** Already-escaped HTML placed between the intro and the button. */
  bodyHtml: string;
  buttonLabel: string;
  buttonUrl: string;
  footerReference: string;
}

export function renderEmailShell(input: EmailShellInput): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f2f0;color:#252122;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f2f0;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #eadedb;border-radius:24px;overflow:hidden">
          <tr><td style="background:#985766;padding:26px 34px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.82">Rental by</div>
            <div style="margin-top:4px;font-size:24px;font-weight:800">Maddy &amp; Cassy</div>
          </td></tr>
          <tr><td style="padding:36px 34px 16px">
            <div style="color:#a45c6b;font-size:12px;font-weight:800;letter-spacing:1.5px">${escapeHtml(input.eyebrow)}</div>
            <h1 style="margin:10px 0 14px;font-size:30px;line-height:1.15;color:#211d1e">${input.heading}</h1>
            <p style="margin:0;color:#5d5557;font-size:16px;line-height:1.7">${input.introHtml}</p>
          </td></tr>
          <tr><td style="padding:12px 34px 16px">${input.bodyHtml}</td></tr>
          <tr><td style="padding:8px 34px 34px">
            <a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;background:#a75e6d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 22px;border-radius:12px">${escapeHtml(input.buttonLabel)}</a>
          </td></tr>
          <tr><td style="border-top:1px solid #efe5e2;padding:22px 34px;color:#8b7d80;font-size:12px;line-height:1.6">
            This message is about booking ${escapeHtml(input.footerReference)}. If you need help, reply to this email or contact Rental by Maddy &amp; Cassy.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
```

- [ ] **Step 5: Implement the Rental Completed email**

Create `src/lib/rentalCompletedEmailContent.ts`:

```ts
import { describeLoyaltyOutcome, type LoyaltyEmailOutcome } from "@/src/lib/loyaltyOutcome";
import {
  escapeHtml,
  firstName,
  formatManilaDate,
  formatPeso,
  renderEmailShell,
  renderSummaryTable,
} from "@/src/lib/emailShell";

export interface RentalCompletedEmailDetails {
  bookingId: string;
  bookingReference: string;
  customerName: string;
  customerEmail: string;
  items: { name: string; quantity: number }[];
  /** ISO timestamp the rental was marked completed. */
  completedAt: string;
  bookingUrl: string;
  isGuest: boolean;
  rentalTotal: number;
  /** Active (not voided) extra charges. Only the type label is shown, never the admin reason. */
  charges: { label: string; amount: number }[];
  totalPaid: number;
  balance: number;
  loyalty: LoyaltyEmailOutcome;
  deliveryKey?: string;
}

export function buildRentalCompletedEmail(details: RentalCompletedEmailDetails) {
  const name = firstName(details.customerName);
  const itemLines = details.items.map((item) => `${item.name} × ${item.quantity}`);
  const completedOn = formatManilaDate(details.completedAt);
  const loyaltyText = describeLoyaltyOutcome(details.loyalty);

  const summaryRows: [string, string | undefined][] = [
    ["BOOKING NUMBER", details.bookingReference],
    ["RENTED ITEM(S)", itemLines.join("\n")],
    ["COMPLETED ON", completedOn],
    ["RENTAL TOTAL", formatPeso(details.rentalTotal)],
    ...details.charges.map((charge): [string, string] => [charge.label, formatPeso(charge.amount)]),
    ["TOTAL PAID", formatPeso(details.totalPaid)],
    ["BALANCE", formatPeso(details.balance)],
  ];

  const loyaltyHtml = loyaltyText
    ? `<div style="margin-top:16px;padding:14px 18px;border:1px solid #eedfdb;border-radius:16px;background:#fbf6f4"><div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#9d5967">LOYALTY</div><p style="margin:6px 0 0;color:#292425;font-size:14px;line-height:1.7">${escapeHtml(loyaltyText)}</p></div>`
    : "";
  const thanks = "Thank you for renting with Maddy & Cassy. We hope to see you again soon!";
  const guestNote = details.isGuest
    ? '<p style="margin:16px 0 0;color:#8b7d80;font-size:12px;line-height:1.6">Your receipt and rental record stay in the secure guest tracker on the browser used at checkout.</p>'
    : "";

  const subject = `Rental ${details.bookingReference} completed — thank you!`;
  const html = renderEmailShell({
    preheader: "Your rental is complete. Here is your summary.",
    eyebrow: "RENTAL COMPLETED",
    heading: `Thank you, ${escapeHtml(name)}!`,
    introHtml: `Your rental is complete. Here is a quick summary for booking <strong>${escapeHtml(details.bookingReference)}</strong>.`,
    bodyHtml: `${renderSummaryTable(summaryRows)}${loyaltyHtml}<p style="margin:16px 0 0;color:#655c5e;font-size:14px;line-height:1.7">${escapeHtml(thanks)}</p>${guestNote}`,
    buttonLabel: "View completed rental",
    buttonUrl: details.bookingUrl,
    footerReference: details.bookingReference,
  });

  const text = [
    `Thank you, ${name}! Your rental is complete.`,
    "",
    `Booking number: ${details.bookingReference}`,
    `Rented item(s): ${itemLines.join(", ")}`,
    ...(completedOn ? [`Completed on: ${completedOn}`] : []),
    `Rental total: ${formatPeso(details.rentalTotal)}`,
    ...details.charges.map((charge) => `${charge.label}: ${formatPeso(charge.amount)}`),
    `Total paid: ${formatPeso(details.totalPaid)}`,
    `Balance: ${formatPeso(details.balance)}`,
    ...(loyaltyText ? ["", `Loyalty: ${loyaltyText}`] : []),
    "",
    thanks,
    "",
    `View your rental: ${details.bookingUrl}`,
  ].join("\n");

  return { subject, html, text };
}
```

- [ ] **Step 6: Implement the Customer Update email**

Create `src/lib/customerUpdateEmailContent.ts`:

```ts
import {
  escapeHtml,
  firstName,
  formatPeso,
  renderEmailShell,
  renderSummaryTable,
} from "@/src/lib/emailShell";

export interface CustomerUpdateEmailDetails {
  bookingReference: string;
  customerName: string;
  /** The admin's subject, used as the email subject. */
  subject: string;
  /** The admin's message. Plain text; blank lines start a new paragraph. */
  message: string;
  bookingUrl: string;
  isGuest: boolean;
  /** Shown as a small details card when the update is about a charge. */
  charge?: { label: string; amount: number; paid: boolean };
}

function messageHtml(message: string): string {
  return message
    .trim()
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 12px;color:#292425;font-size:15px;line-height:1.7">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
}

/** Used for both the real email and the admin's preview, so they always match. */
export function buildCustomerUpdateEmail(details: CustomerUpdateEmailDetails) {
  const name = firstName(details.customerName);
  const chargeRows: [string, string][] | null = details.charge
    ? [[details.charge.label, `${formatPeso(details.charge.amount)} (${details.charge.paid ? "Paid" : "Unpaid"})`]]
    : null;
  const chargeHtml = chargeRows ? `<div style="margin-top:8px">${renderSummaryTable(chargeRows)}</div>` : "";

  const html = renderEmailShell({
    preheader: details.subject,
    eyebrow: "BOOKING UPDATE",
    heading: escapeHtml(details.subject),
    introHtml: `Hi ${escapeHtml(name)}, we have an update about your booking <strong>${escapeHtml(details.bookingReference)}</strong>.`,
    bodyHtml: `${messageHtml(details.message)}${chargeHtml}`,
    buttonLabel: "View your booking",
    buttonUrl: details.bookingUrl,
    footerReference: details.bookingReference,
  });

  const text = [
    `Hi ${name}, we have an update about your booking ${details.bookingReference}.`,
    "",
    details.message.trim(),
    ...(details.charge
      ? ["", `${details.charge.label}: ${formatPeso(details.charge.amount)} (${details.charge.paid ? "Paid" : "Unpaid"})`]
      : []),
    "",
    `View your booking: ${details.bookingUrl}`,
  ].join("\n");

  return { subject: details.subject, html, text };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx tsx --test scripts/testFulfillmentEmails.ts`
Expected: PASS, 9 tests. Then run `npm run test:fulfillment` (both files) and `npx tsc --noEmit`; both must pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/loyaltyOutcome.ts src/lib/emailShell.ts src/lib/rentalCompletedEmailContent.ts src/lib/customerUpdateEmailContent.ts scripts/testFulfillmentEmails.ts
git commit -m "feat: add loyalty outcome and fulfillment email builders"
```

### Task 3: Migration and database types

**Files:**
- Create: `supabase/migrations/20260921120000_rental_fulfillment.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `src/lib/supabase/storage.ts`

**Interfaces:**
- Produces (SQL):
  - `bookings.approval_email_status` (`'sent' | 'failed' | 'legacy' | null`), `approval_email_sent_at`, `completion_email_sent_at`, `completion_email_to`
  - Tables `booking_fulfillment_records`, `booking_charges`, `booking_customer_updates`
  - Storage bucket `condition-photos` (private, admin-only insert/read)
  - RPCs (all `authenticated`, admin-checked): `admin_record_pickup(p_booking_id uuid, p_picked_up_at timestamptz, p_notes text)`, `admin_record_return(p_booking_id uuid, p_returned_at timestamptz, p_notes text)`, `admin_save_item_condition(p_booking_id uuid, p_condition text, p_notes text, p_photo_paths text[])`, `admin_add_booking_charge(p_booking_id uuid, p_charge_type text, p_amount numeric, p_reason text)`, `admin_mark_charge_paid(p_charge_id uuid, p_method text, p_paid_at timestamptz)`, `admin_void_booking_charge(p_charge_id uuid, p_reason text)`, `admin_complete_rental(p_booking_id uuid, p_note text)`
  - Error codes raised: `NOT_AUTHORIZED`, `BOOKING_NOT_FOUND`, `PICKUP_NOT_READY`, `RETURN_NOT_READY`, `RETURN_BEFORE_PICKUP`, `CONDITION_NOT_READY`, `INVALID_CONDITION`, `DAMAGE_NOTES_REQUIRED`, `TOO_MANY_PHOTOS`, `INVALID_PHOTO_PATH`, `INVALID_DATE`, `CHARGE_NOT_ALLOWED`, `INVALID_CHARGE_TYPE`, `INVALID_AMOUNT`, `REASON_REQUIRED`, `CHARGE_NOT_FOUND`, `CHARGE_VOIDED`, `CHARGE_ALREADY_PAID`, `INVALID_METHOD`, `RENTAL_COMPLETED`, `COMPLETION_BLOCKED`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260921120000_rental_fulfillment.sql`:

```sql
-- Rental Fulfillment: post-approval pickup/return/condition/charges/customer updates and a
-- guarded, idempotent "Complete Rental". Additive only: no existing column, row content,
-- payment, document, agreement or loyalty data is changed or removed.
begin;

-- 1. Email tracking on bookings ---------------------------------------------------------
alter table public.bookings
  add column if not exists approval_email_status text,
  add column if not exists approval_email_sent_at timestamptz,
  add column if not exists completion_email_sent_at timestamptz,
  add column if not exists completion_email_to text;

alter table public.bookings drop constraint if exists bookings_approval_email_status_check;
alter table public.bookings add constraint bookings_approval_email_status_check
  check (approval_email_status is null or approval_email_status in ('sent', 'failed', 'legacy'));

-- Bookings approved before tracking existed: delivery is unknown, so mark them legacy. Only the
-- new column is filled in. The release guard trigger runs on "update of status" only.
update public.bookings
set approval_email_status = 'legacy'
where approved_at is not null and approval_email_status is null;

-- 2. Fulfillment records (one per booking) ------------------------------------------------
create table if not exists public.booking_fulfillment_records (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  picked_up boolean not null default false,
  actual_pickup_at timestamptz,
  pickup_notes text,
  returned boolean not null default false,
  actual_return_at timestamptz,
  return_notes text,
  item_condition text,
  condition_notes text,
  condition_photo_paths text[] not null default '{}',
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_fulfillment_condition_check
    check (item_condition is null or item_condition in ('good', 'damaged')),
  constraint booking_fulfillment_pickup_check
    check (not picked_up or actual_pickup_at is not null),
  constraint booking_fulfillment_return_check
    check (not returned or actual_return_at is not null),
  constraint booking_fulfillment_photos_check
    check (coalesce(array_length(condition_photo_paths, 1), 0) <= 6)
);

-- 3. Extra charges (void, never delete) ---------------------------------------------------
create table if not exists public.booking_charges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  charge_type text not null,
  amount numeric(12, 2) not null,
  reason text not null,
  payment_status text not null default 'unpaid',
  payment_method text,
  paid_at timestamptz,
  paid_recorded_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  constraint booking_charges_type_check check (charge_type in ('late_fee', 'damage_fee', 'other')),
  constraint booking_charges_amount_check check (amount > 0 and amount <= 1000000),
  constraint booking_charges_reason_check check (length(trim(reason)) >= 3),
  constraint booking_charges_payment_status_check check (payment_status in ('unpaid', 'paid')),
  constraint booking_charges_method_check
    check (payment_method is null or payment_method in ('cash', 'gcash', 'other')),
  constraint booking_charges_paid_consistency check (
    (payment_status = 'paid' and payment_method is not null and paid_at is not null)
    or (payment_status = 'unpaid' and payment_method is null and paid_at is null)
  ),
  constraint booking_charges_void_consistency check (
    voided_at is null or (void_reason is not null and length(trim(void_reason)) >= 3)
  )
);

create index if not exists booking_charges_booking_idx on public.booking_charges (booking_id, created_at);

-- 4. Customer updates (email history) -----------------------------------------------------
create table if not exists public.booking_customer_updates (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  subject text not null,
  message text not null,
  sent_to text,
  sent_by uuid references auth.users(id),
  admin_note text,
  related_charge_id uuid references public.booking_charges(id) on delete set null,
  delivery_status text not null default 'failed',
  delivery_attempts integer not null default 0,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint booking_customer_updates_status_check check (delivery_status in ('sent', 'failed')),
  constraint booking_customer_updates_subject_check check (length(trim(subject)) between 1 and 150),
  constraint booking_customer_updates_message_check check (length(trim(message)) between 1 and 5000)
);

create index if not exists booking_customer_updates_booking_idx
  on public.booking_customer_updates (booking_id, created_at desc);

-- 5. Row level security: admins read; writes go through the RPCs below or the service role -
alter table public.booking_fulfillment_records enable row level security;
alter table public.booking_charges enable row level security;
alter table public.booking_customer_updates enable row level security;

drop policy if exists booking_fulfillment_records_admin_read on public.booking_fulfillment_records;
create policy booking_fulfillment_records_admin_read
on public.booking_fulfillment_records for select to authenticated
using ((select private.is_admin()));

drop policy if exists booking_charges_admin_read on public.booking_charges;
create policy booking_charges_admin_read
on public.booking_charges for select to authenticated
using ((select private.is_admin()));

drop policy if exists booking_customer_updates_admin_read on public.booking_customer_updates;
create policy booking_customer_updates_admin_read
on public.booking_customer_updates for select to authenticated
using ((select private.is_admin()));

revoke all on table public.booking_fulfillment_records from anon, authenticated;
revoke all on table public.booking_charges from anon, authenticated;
revoke all on table public.booking_customer_updates from anon, authenticated;
grant select on table public.booking_fulfillment_records to authenticated;
grant select on table public.booking_charges to authenticated;
grant select on table public.booking_customer_updates to authenticated;
grant all on table public.booking_fulfillment_records to service_role;
grant all on table public.booking_charges to service_role;
grant all on table public.booking_customer_updates to service_role;

-- 6. Private storage bucket for condition photos ------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'condition-photos', 'condition-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists condition_photos_admin_insert on storage.objects;
create policy condition_photos_admin_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'condition-photos' and (select private.is_admin()));

drop policy if exists condition_photos_admin_read on storage.objects;
create policy condition_photos_admin_read
on storage.objects for select to authenticated
using (bucket_id = 'condition-photos' and (select private.is_admin()));

-- 7. Helpers -------------------------------------------------------------------------------
create or replace function private.fulfillment_assert_admin()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select private.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.fulfillment_lock_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  perform private.fulfillment_assert_admin();
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  return v_booking;
end;
$$;

revoke all on function private.fulfillment_assert_admin() from public, anon, authenticated;
revoke all on function private.fulfillment_lock_booking(uuid) from public, anon, authenticated;

-- 8. Pickup: uses the existing released transition, so the balance guard still applies ------
create or replace function public.admin_record_pickup(
  p_booking_id uuid,
  p_picked_up_at timestamptz,
  p_notes text default null
)
returns public.booking_fulfillment_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status not in ('ready_for_release', 'released') then
    raise exception 'PICKUP_NOT_READY';
  end if;
  if p_picked_up_at is null or p_picked_up_at > now() + interval '5 minutes' then
    raise exception 'INVALID_DATE';
  end if;

  if v_booking.status = 'ready_for_release' then
    -- Raises BALANCE_PAYMENT_REQUIRED from the existing trigger when a balance is still due.
    perform public.admin_set_booking_status(p_booking_id, 'released', v_notes);
  end if;

  insert into public.booking_fulfillment_records
    (booking_id, picked_up, actual_pickup_at, pickup_notes, updated_by)
  values (p_booking_id, true, p_picked_up_at, v_notes, auth.uid())
  on conflict (booking_id) do update set
    picked_up = true,
    actual_pickup_at = excluded.actual_pickup_at,
    pickup_notes = excluded.pickup_notes,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_record;

  perform private.log_audit_event(
    'booking.pickup_recorded', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('pickedUpAt', p_picked_up_at),
    jsonb_build_object('note', v_notes), 'admin'
  );
  return v_record;
end;
$$;

-- 9. Return -----------------------------------------------------------------------------------
create or replace function public.admin_record_return(
  p_booking_id uuid,
  p_returned_at timestamptz,
  p_notes text default null
)
returns public.booking_fulfillment_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status <> 'released' then
    raise exception 'RETURN_NOT_READY';
  end if;
  select * into v_record from public.booking_fulfillment_records where booking_id = p_booking_id;
  if v_record.booking_id is null or not v_record.picked_up then
    raise exception 'RETURN_NOT_READY';
  end if;
  if p_returned_at is null or p_returned_at > now() + interval '5 minutes' then
    raise exception 'INVALID_DATE';
  end if;
  if p_returned_at < v_record.actual_pickup_at then
    raise exception 'RETURN_BEFORE_PICKUP';
  end if;

  update public.booking_fulfillment_records
  set returned = true,
      actual_return_at = p_returned_at,
      return_notes = v_notes,
      updated_by = auth.uid(),
      updated_at = now()
  where booking_id = p_booking_id
  returning * into v_record;

  perform private.log_audit_event(
    'booking.return_recorded', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('returnedAt', p_returned_at),
    jsonb_build_object('note', v_notes), 'admin'
  );
  return v_record;
end;
$$;

-- 10. Item condition --------------------------------------------------------------------------
create or replace function public.admin_save_item_condition(
  p_booking_id uuid,
  p_condition text,
  p_notes text default null,
  p_photo_paths text[] default '{}'
)
returns public.booking_fulfillment_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_paths text[] := coalesce(p_photo_paths, '{}');
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status <> 'released' then
    raise exception 'CONDITION_NOT_READY';
  end if;
  if p_condition is null or p_condition not in ('good', 'damaged') then
    raise exception 'INVALID_CONDITION';
  end if;
  if p_condition = 'damaged' and v_notes is null then
    raise exception 'DAMAGE_NOTES_REQUIRED';
  end if;
  if coalesce(array_length(v_paths, 1), 0) > 6 then
    raise exception 'TOO_MANY_PHOTOS';
  end if;
  if exists (
    select 1 from unnest(v_paths) as photo(photo_path)
    where photo_path not like p_booking_id::text || '/%'
  ) then
    raise exception 'INVALID_PHOTO_PATH';
  end if;

  insert into public.booking_fulfillment_records
    (booking_id, item_condition, condition_notes, condition_photo_paths, updated_by)
  values (p_booking_id, p_condition, v_notes, v_paths, auth.uid())
  on conflict (booking_id) do update set
    item_condition = excluded.item_condition,
    condition_notes = excluded.condition_notes,
    condition_photo_paths = excluded.condition_photo_paths,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_record;

  perform private.log_audit_event(
    'booking.condition_recorded', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('condition', p_condition, 'photoCount', coalesce(array_length(v_paths, 1), 0)),
    jsonb_build_object('note', v_notes), 'admin'
  );
  return v_record;
end;
$$;

-- 11. Charges ---------------------------------------------------------------------------------
create or replace function public.admin_add_booking_charge(
  p_booking_id uuid,
  p_charge_type text,
  p_amount numeric,
  p_reason text
)
returns public.booking_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_charge public.booking_charges;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);
  if v_booking.status not in ('confirmed', 'ready_for_release', 'released') then
    raise exception 'CHARGE_NOT_ALLOWED';
  end if;
  if p_charge_type is null or p_charge_type not in ('late_fee', 'damage_fee', 'other') then
    raise exception 'INVALID_CHARGE_TYPE';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED';
  end if;

  insert into public.booking_charges (booking_id, charge_type, amount, reason, created_by)
  values (p_booking_id, p_charge_type, round(p_amount, 2), v_reason, auth.uid())
  returning * into v_charge;

  perform private.log_audit_event(
    'booking.charge_added', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('chargeId', v_charge.id, 'type', p_charge_type, 'amount', v_charge.amount),
    jsonb_build_object('reason', v_reason), 'admin'
  );
  return v_charge;
end;
$$;

create or replace function public.admin_mark_charge_paid(
  p_charge_id uuid,
  p_method text,
  p_paid_at timestamptz
)
returns public.booking_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  v_booking public.bookings;
  v_charge public.booking_charges;
begin
  perform private.fulfillment_assert_admin();
  select booking_id into v_booking_id from public.booking_charges where id = p_charge_id;
  if v_booking_id is null then
    raise exception 'CHARGE_NOT_FOUND';
  end if;
  v_booking := private.fulfillment_lock_booking(v_booking_id);
  if v_booking.status in ('returned', 'cancelled', 'rejected') then
    raise exception 'RENTAL_COMPLETED';
  end if;
  select * into v_charge from public.booking_charges where id = p_charge_id for update;
  if v_charge.voided_at is not null then
    raise exception 'CHARGE_VOIDED';
  end if;
  if v_charge.payment_status = 'paid' then
    raise exception 'CHARGE_ALREADY_PAID';
  end if;
  if p_method is null or p_method not in ('cash', 'gcash', 'other') then
    raise exception 'INVALID_METHOD';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '5 minutes' then
    raise exception 'INVALID_DATE';
  end if;

  update public.booking_charges
  set payment_status = 'paid',
      payment_method = p_method,
      paid_at = p_paid_at,
      paid_recorded_by = auth.uid()
  where id = p_charge_id
  returning * into v_charge;

  perform private.log_audit_event(
    'booking.charge_paid', 'booking', v_booking_id::text, v_booking_id,
    null::jsonb, jsonb_build_object('chargeId', p_charge_id, 'method', p_method, 'amount', v_charge.amount),
    '{}'::jsonb, 'admin'
  );
  return v_charge;
end;
$$;

create or replace function public.admin_void_booking_charge(
  p_charge_id uuid,
  p_reason text
)
returns public.booking_charges
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  v_booking public.bookings;
  v_charge public.booking_charges;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  perform private.fulfillment_assert_admin();
  select booking_id into v_booking_id from public.booking_charges where id = p_charge_id;
  if v_booking_id is null then
    raise exception 'CHARGE_NOT_FOUND';
  end if;
  v_booking := private.fulfillment_lock_booking(v_booking_id);
  if v_booking.status in ('returned', 'cancelled', 'rejected') then
    raise exception 'RENTAL_COMPLETED';
  end if;
  select * into v_charge from public.booking_charges where id = p_charge_id for update;
  if v_charge.voided_at is not null then
    raise exception 'CHARGE_VOIDED';
  end if;
  if length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.booking_charges
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = p_charge_id
  returning * into v_charge;

  perform private.log_audit_event(
    'booking.charge_voided', 'booking', v_booking_id::text, v_booking_id,
    null::jsonb, jsonb_build_object('chargeId', p_charge_id, 'amount', v_charge.amount),
    jsonb_build_object('reason', v_reason), 'admin'
  );
  return v_charge;
end;
$$;

-- 12. Complete Rental: transactional and idempotent ---------------------------------------------
-- Loyalty needs no write here: the existing rule counts bookings whose status is 'returned', and
-- the reward is single-use per account, so a retry can never award anything twice.
create or replace function public.admin_complete_rental(
  p_booking_id uuid,
  p_note text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_record public.booking_fulfillment_records;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_unpaid_charges integer := 0;
  v_pending_reviews integer := 0;
begin
  v_booking := private.fulfillment_lock_booking(p_booking_id);

  -- Already completed: a repeat call changes nothing.
  if v_booking.status = 'returned' then
    return v_booking;
  end if;
  if v_booking.status <> 'released' then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  select * into v_record from public.booking_fulfillment_records where booking_id = p_booking_id;
  if v_record.booking_id is null
     or not v_record.picked_up
     or not v_record.returned
     or v_record.item_condition is null then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  select coalesce(bt.total_amount, 0) into v_total
  from public.booking_totals bt where bt.booking_id = p_booking_id;

  select coalesce(sum(bps.declared_amount), 0) into v_paid
  from public.booking_payment_submissions bps
  where bps.booking_id = p_booking_id and bps.status = 'verified';
  if v_paid < v_total - 0.01 then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  select count(*) into v_unpaid_charges
  from public.booking_charges c
  where c.booking_id = p_booking_id and c.voided_at is null and c.payment_status <> 'paid';
  if v_unpaid_charges > 0 then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  select count(*) into v_pending_reviews
  from public.booking_payment_submissions bps
  where bps.booking_id = p_booking_id and bps.status in ('submitted', 'under_review');
  if v_pending_reviews > 0 then
    raise exception 'COMPLETION_BLOCKED';
  end if;

  -- Existing transition: sets returned_at, frees reservations, writes history and notification.
  perform public.admin_set_booking_status(p_booking_id, 'returned', nullif(trim(coalesce(p_note, '')), ''));
  select * into v_booking from public.bookings where id = p_booking_id;

  perform private.log_audit_event(
    'booking.rental_completed', 'booking', p_booking_id::text, p_booking_id,
    null::jsonb, jsonb_build_object('status', 'returned'),
    jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), '')), 'admin'
  );
  return v_booking;
end;
$$;

-- 13. Permissions ---------------------------------------------------------------------------------
revoke all on function public.admin_record_pickup(uuid, timestamptz, text) from public, anon;
revoke all on function public.admin_record_return(uuid, timestamptz, text) from public, anon;
revoke all on function public.admin_save_item_condition(uuid, text, text, text[]) from public, anon;
revoke all on function public.admin_add_booking_charge(uuid, text, numeric, text) from public, anon;
revoke all on function public.admin_mark_charge_paid(uuid, text, timestamptz) from public, anon;
revoke all on function public.admin_void_booking_charge(uuid, text) from public, anon;
revoke all on function public.admin_complete_rental(uuid, text) from public, anon;

grant execute on function public.admin_record_pickup(uuid, timestamptz, text) to authenticated;
grant execute on function public.admin_record_return(uuid, timestamptz, text) to authenticated;
grant execute on function public.admin_save_item_condition(uuid, text, text, text[]) to authenticated;
grant execute on function public.admin_add_booking_charge(uuid, text, numeric, text) to authenticated;
grant execute on function public.admin_mark_charge_paid(uuid, text, timestamptz) to authenticated;
grant execute on function public.admin_void_booking_charge(uuid, text) to authenticated;
grant execute on function public.admin_complete_rental(uuid, text) to authenticated;

commit;
```

- [ ] **Step 2: Re-read the migration against the codebase**

Open `supabase/migrations/20260820130000_fix_booking_rejection_status.sql` (latest `admin_set_booking_status`) and confirm: the function takes `(p_booking_id uuid, p_new_status text, p_note text)`, allows `ready_for_release -> released` and `released -> returned`, and raises `INVALID_STATUS_TRANSITION` otherwise. Confirm `private.log_audit_event` accepts eight arguments `(text, text, text, uuid, jsonb, jsonb, jsonb, text)` by opening `20260805000000_fix_audit_log_entity_id_uuid_cast.sql`. If either differs, adjust the calls in the migration to match. The migration is applied to the database in Task 14, not here.

- [ ] **Step 3: Add the storage bucket constant**

In `src/lib/supabase/storage.ts`, add one line inside `STORAGE_BUCKETS` after `invoices`:

```ts
  conditionPhotos: "condition-photos",
```

- [ ] **Step 4: Add the new columns to the `bookings` types**

In `src/lib/supabase/database.types.ts`, inside `bookings: { ... }` (starts near line 937), add the following after the `approved_at` line in each of the three blocks.

`Row` (after `approved_at: string | null`):

```ts
          approval_email_sent_at: string | null
          approval_email_status: string | null
          completion_email_sent_at: string | null
          completion_email_to: string | null
```

`Insert` (after `approved_at?: string | null`):

```ts
          approval_email_sent_at?: string | null
          approval_email_status?: string | null
          completion_email_sent_at?: string | null
          completion_email_to?: string | null
```

`Update` (after `approved_at?: string | null`):

```ts
          approval_email_sent_at?: string | null
          approval_email_status?: string | null
          completion_email_sent_at?: string | null
          completion_email_to?: string | null
```

- [ ] **Step 5: Add the three tables to the types**

In the same file, insert the following immediately before `      booking_items: {` (near line 489, inside `Tables`):

```ts
      booking_charges: {
        Row: {
          amount: number
          booking_id: string
          charge_type: string
          created_at: string
          created_by: string | null
          id: string
          paid_at: string | null
          paid_recorded_by: string | null
          payment_method: string | null
          payment_status: string
          reason: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          booking_id: string
          charge_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          paid_at?: string | null
          paid_recorded_by?: string | null
          payment_method?: string | null
          payment_status?: string
          reason: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string
          charge_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          paid_at?: string | null
          paid_recorded_by?: string | null
          payment_method?: string | null
          payment_status?: string
          reason?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_customer_updates: {
        Row: {
          admin_note: string | null
          booking_id: string
          created_at: string
          delivery_attempts: number
          delivery_status: string
          first_attempt_at: string | null
          id: string
          last_attempt_at: string | null
          message: string
          related_charge_id: string | null
          sent_at: string | null
          sent_by: string | null
          sent_to: string | null
          subject: string
        }
        Insert: {
          admin_note?: string | null
          booking_id: string
          created_at?: string
          delivery_attempts?: number
          delivery_status?: string
          first_attempt_at?: string | null
          id?: string
          last_attempt_at?: string | null
          message: string
          related_charge_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_to?: string | null
          subject: string
        }
        Update: {
          admin_note?: string | null
          booking_id?: string
          created_at?: string
          delivery_attempts?: number
          delivery_status?: string
          first_attempt_at?: string | null
          id?: string
          last_attempt_at?: string | null
          message?: string
          related_charge_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_to?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_customer_updates_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_customer_updates_related_charge_id_fkey"
            columns: ["related_charge_id"]
            isOneToOne: false
            referencedRelation: "booking_charges"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_fulfillment_records: {
        Row: {
          actual_pickup_at: string | null
          actual_return_at: string | null
          booking_id: string
          condition_notes: string | null
          condition_photo_paths: string[]
          created_at: string
          item_condition: string | null
          picked_up: boolean
          pickup_notes: string | null
          return_notes: string | null
          returned: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actual_pickup_at?: string | null
          actual_return_at?: string | null
          booking_id: string
          condition_notes?: string | null
          condition_photo_paths?: string[]
          created_at?: string
          item_condition?: string | null
          picked_up?: boolean
          pickup_notes?: string | null
          return_notes?: string | null
          returned?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actual_pickup_at?: string | null
          actual_return_at?: string | null
          booking_id?: string
          condition_notes?: string | null
          condition_photo_paths?: string[]
          created_at?: string
          item_condition?: string | null
          picked_up?: boolean
          pickup_notes?: string | null
          return_notes?: string | null
          returned?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_fulfillment_records_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 6: Add the RPC types**

In the same file, insert the following at the start of the `Functions: {` block (near line 1821, before `recover_guest_booking_access`). Because they are inserted after the table additions, the line numbers have shifted; search for `    Functions: {`.

```ts
      admin_record_pickup: {
        Args: { p_booking_id: string; p_notes?: string; p_picked_up_at: string }
        Returns: Database["public"]["Tables"]["booking_fulfillment_records"]["Row"]
        SetofOptions: {
          from: "*"
          to: "booking_fulfillment_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_record_return: {
        Args: { p_booking_id: string; p_notes?: string; p_returned_at: string }
        Returns: Database["public"]["Tables"]["booking_fulfillment_records"]["Row"]
        SetofOptions: {
          from: "*"
          to: "booking_fulfillment_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_item_condition: {
        Args: { p_booking_id: string; p_condition: string; p_notes?: string; p_photo_paths?: string[] }
        Returns: Database["public"]["Tables"]["booking_fulfillment_records"]["Row"]
        SetofOptions: {
          from: "*"
          to: "booking_fulfillment_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_add_booking_charge: {
        Args: { p_amount: number; p_booking_id: string; p_charge_type: string; p_reason: string }
        Returns: Database["public"]["Tables"]["booking_charges"]["Row"]
        SetofOptions: {
          from: "*"
          to: "booking_charges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_mark_charge_paid: {
        Args: { p_charge_id: string; p_method: string; p_paid_at: string }
        Returns: Database["public"]["Tables"]["booking_charges"]["Row"]
        SetofOptions: {
          from: "*"
          to: "booking_charges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_void_booking_charge: {
        Args: { p_charge_id: string; p_reason: string }
        Returns: Database["public"]["Tables"]["booking_charges"]["Row"]
        SetofOptions: {
          from: "*"
          to: "booking_charges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_complete_rental: {
        Args: { p_booking_id: string; p_note?: string }
        Returns: Database["public"]["Tables"]["bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS with no new errors. If `Returns: Database["public"]["Tables"]...` is rejected in this position, replace each with the row's inline shape copied from the matching table's `Row` block above.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260921120000_rental_fulfillment.sql src/lib/supabase/database.types.ts src/lib/supabase/storage.ts
git commit -m "feat: add rental fulfillment schema, RPCs and types"
```

### Task 4: Server email pieces

**Files:**
- Create: `src/lib/fulfillmentMappers.ts`
- Create: `src/lib/server/emailTransport.ts`
- Modify: `src/lib/server/bookingStatusEmail.ts`
- Modify: `src/lib/server/bookingApprovalEmail.ts`
- Create: `src/lib/server/bookingRecipient.ts`
- Create: `src/lib/server/rentalCompletedEmail.ts`
- Create: `src/lib/server/customerUpdateEmail.ts`

**Interfaces:**
- Consumes: Task 1 (`activeCharges`, `CHARGE_TYPE_LABELS`), Task 2 (`buildRentalCompletedEmail`, `buildCustomerUpdateEmail`, `getLoyaltyEmailOutcome`), Task 3 (table types).
- Produces:
  - `mapCharge(row)`, `mapFulfillmentRecord(row)`, `mapCustomerUpdate(row)` in `src/lib/fulfillmentMappers.ts`
  - `sendEmail(message: EmailMessage): Promise<EmailSendResult>`
  - `sendBookingApprovalEmail(...)` now also records `approval_email_status` (signature unchanged)
  - `sendRentalCompletedEmail(options: { bookingId: string; origin: string; resend?: boolean }): Promise<CompletionEmailOutcome>` where `CompletionEmailOutcome = { sent: boolean; emailedTo?: string; reason?: EmailSendResult["reason"] | "not_found" | "not_completed" | "load_failed" }`
  - `deliverCustomerUpdate(options: { updateId: string; origin: string }): Promise<CustomerUpdateDeliveryOutcome>` where `CustomerUpdateDeliveryOutcome = { delivered: boolean; emailedTo?: string; reason?: EmailSendResult["reason"] | "not_found" | "already_sent" | "load_failed" }`
  - `resolveBookingRecipientEmail(admin, booking): Promise<string>`

- [ ] **Step 1: Add the row mappers**

Create `src/lib/fulfillmentMappers.ts`:

```ts
import type { Tables } from "@/src/lib/supabase/database.types";
import type {
  BookingCharge,
  ChargePaymentMethod,
  ChargeType,
  CustomerUpdate,
  FulfillmentRecord,
  ItemCondition,
} from "@/src/types/fulfillment";

export function mapCharge(row: Tables<"booking_charges">): BookingCharge {
  return {
    id: row.id,
    bookingId: row.booking_id,
    chargeType: row.charge_type as ChargeType,
    amount: Number(row.amount),
    reason: row.reason,
    paymentStatus: row.payment_status === "paid" ? "paid" : "unpaid",
    paymentMethod: (row.payment_method as ChargePaymentMethod | null) ?? undefined,
    paidAt: row.paid_at ?? undefined,
    paidRecordedBy: row.paid_recorded_by ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    voidedAt: row.voided_at ?? undefined,
    voidedBy: row.voided_by ?? undefined,
    voidReason: row.void_reason ?? undefined,
  };
}

export function mapFulfillmentRecord(row: Tables<"booking_fulfillment_records">): FulfillmentRecord {
  return {
    bookingId: row.booking_id,
    pickedUp: row.picked_up,
    actualPickupAt: row.actual_pickup_at ?? undefined,
    pickupNotes: row.pickup_notes ?? undefined,
    returned: row.returned,
    actualReturnAt: row.actual_return_at ?? undefined,
    returnNotes: row.return_notes ?? undefined,
    itemCondition: (row.item_condition as ItemCondition | null) ?? null,
    conditionNotes: row.condition_notes ?? undefined,
    conditionPhotoPaths: row.condition_photo_paths ?? [],
    updatedAt: row.updated_at,
  };
}

export function mapCustomerUpdate(row: Tables<"booking_customer_updates">): CustomerUpdate {
  return {
    id: row.id,
    bookingId: row.booking_id,
    subject: row.subject,
    message: row.message,
    sentTo: row.sent_to ?? undefined,
    sentBy: row.sent_by ?? undefined,
    adminNote: row.admin_note ?? undefined,
    relatedChargeId: row.related_charge_id ?? undefined,
    deliveryStatus: row.delivery_status === "sent" ? "sent" : "failed",
    deliveryAttempts: row.delivery_attempts,
    firstAttemptAt: row.first_attempt_at ?? undefined,
    lastAttemptAt: row.last_attempt_at ?? undefined,
    sentAt: row.sent_at ?? undefined,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 2: Extract the email transport**

Create `src/lib/server/emailTransport.ts`:

```ts
import "server-only";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export interface EmailSendResult {
  sent: boolean;
  providerId?: string;
  reason?: "not_configured" | "invalid_recipient" | "provider_error";
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Sending the same key twice makes the provider ignore the second send. */
  idempotencyKey: string;
  tags?: { name: string; value: string }[];
  /** Logged (server-side only) when the provider rejects the request. */
  logContext?: Record<string, unknown>;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Sends one email through Resend. Never throws; technical errors are only logged. */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.BOOKING_EMAIL_FROM?.trim();
  const replyTo = process.env.BOOKING_EMAIL_REPLY_TO?.trim();

  if (!apiKey || !from) return { sent: false, reason: "not_configured" };
  if (!isEmail(message.to)) return { sent: false, reason: "invalid_recipient" };

  const idempotencyKey = message.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 256);

  try {
    const response = await fetch(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(message.tags?.length ? { tags: message.tags } : {}),
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as
      | { id?: unknown; name?: unknown; message?: unknown }
      | null;
    if (!response.ok || typeof payload?.id !== "string") {
      console.error("Booking email provider rejected the request", {
        ...message.logContext,
        providerStatus: response.status,
        providerError: typeof payload?.name === "string" ? payload.name : undefined,
        providerMessage: typeof payload?.message === "string" ? payload.message : undefined,
      });
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true, providerId: payload.id };
  } catch (error) {
    console.error("Booking email request failed", {
      ...message.logContext,
      error: error instanceof Error ? error.message : "Unknown provider error",
    });
    return { sent: false, reason: "provider_error" };
  }
}

/** Resend tag values may only contain letters, numbers, underscores and dashes. */
export function safeTagValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
```

- [ ] **Step 3: Make `bookingStatusEmail.ts` use the transport (behavior unchanged)**

Replace the whole content of `src/lib/server/bookingStatusEmail.ts` with:

```ts
import "server-only";

import {
  buildBookingStatusEmail,
  type BookingStatusEmailDetails,
} from "@/src/lib/bookingStatusEmailContent";
import { safeTagValue, sendEmail, type EmailSendResult } from "@/src/lib/server/emailTransport";

export type BookingStatusEmailResult = EmailSendResult;

export function isBookingEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.BOOKING_EMAIL_FROM?.trim());
}

/**
 * Names (never values) of the server settings a booking email needs but that are
 * empty. Server-console diagnostics only: admins never see these names.
 */
export function missingBookingEmailSettings(): string[] {
  return ["RESEND_API_KEY", "BOOKING_EMAIL_FROM", "SUPABASE_SECRET_KEY"].filter(
    (name) => !process.env[name]?.trim(),
  );
}

export async function sendBookingStatusEmail(
  details: BookingStatusEmailDetails,
): Promise<BookingStatusEmailResult> {
  const email = buildBookingStatusEmail(details);
  return sendEmail({
    to: details.customerEmail,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey:
      details.deliveryKey ?? `booking-${details.status}-${details.bookingId}-${details.statusChangedAt}`,
    tags: [
      { name: "booking_status", value: details.status },
      { name: "booking_reference", value: safeTagValue(details.bookingReference) },
    ],
    logContext: { bookingId: details.bookingId, status: details.status },
  });
}
```

- [ ] **Step 4: Record the approval email outcome**

In `src/lib/server/bookingApprovalEmail.ts`, make two edits.

Edit 1. Change the exported function into an internal one. Replace:

```ts
export async function sendBookingApprovalEmail({
  bookingId,
  origin,
  resend = false,
}: SendBookingApprovalEmailOptions): Promise<BookingApprovalEmailOutcome> {
```

with:

```ts
async function attemptBookingApprovalEmail({
  bookingId,
  origin,
  resend = false,
}: SendBookingApprovalEmailOptions): Promise<BookingApprovalEmailOutcome> {
```

Edit 2. Append at the end of the file:

```ts

/**
 * Saves how the approval email went so the admin page can decide when to switch to Rental
 * Fulfillment. A failed resend never downgrades an earlier "sent" or "legacy" state, and a
 * failed first send only marks bookings that have no state yet. Never throws.
 */
async function recordApprovalEmailOutcome(bookingId: string, sent: boolean, resend: boolean): Promise<void> {
  try {
    const admin = createAdminClient();
    if (sent) {
      const { error } = await admin
        .from("bookings")
        .update({ approval_email_status: "sent", approval_email_sent_at: new Date().toISOString() })
        .eq("id", bookingId);
      if (error) console.error("Approval email status could not be saved", { bookingId, error: error.message });
      return;
    }
    if (resend) return;
    const { error } = await admin
      .from("bookings")
      .update({ approval_email_status: "failed" })
      .eq("id", bookingId)
      .is("approval_email_status", null);
    if (error) console.error("Approval email status could not be saved", { bookingId, error: error.message });
  } catch (error) {
    console.error("Approval email status could not be saved", {
      bookingId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Sends the Approval Confirmation email and records the outcome on the booking. Same contract
 * as before: it never throws and the outcome is returned for the caller to turn into a message.
 */
export async function sendBookingApprovalEmail(
  options: SendBookingApprovalEmailOptions,
): Promise<BookingApprovalEmailOutcome> {
  const outcome = await attemptBookingApprovalEmail(options);
  if (outcome.reason !== "not_found") {
    await recordApprovalEmailOutcome(options.bookingId, outcome.sent, options.resend === true);
  }
  return outcome;
}
```

- [ ] **Step 5: Add the recipient helper**

Create `src/lib/server/bookingRecipient.ts`:

```ts
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";
import type { Booking } from "@/src/types/booking";

/**
 * The email saved on the booking (where guest checkout keeps the guest's address), falling back
 * to the account email only when that is blank. Returns "" when neither exists.
 */
export async function resolveBookingRecipientEmail(
  admin: SupabaseClient<Database>,
  booking: Booking,
): Promise<string> {
  const saved = booking.customerSnapshot.email.trim();
  if (saved) return saved;
  const { data } = await admin.auth.admin.getUserById(booking.customerId);
  return data?.user?.email?.trim() ?? "";
}
```

- [ ] **Step 6: Add the Rental Completed sender**

Create `src/lib/server/rentalCompletedEmail.ts`:

```ts
import "server-only";

import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { mapCharge } from "@/src/lib/fulfillmentMappers";
import { getLoyaltyEmailOutcome, type LoyaltyEmailOutcome } from "@/src/lib/loyaltyOutcome";
import { buildRentalCompletedEmail } from "@/src/lib/rentalCompletedEmailContent";
import { activeCharges, CHARGE_TYPE_LABELS } from "@/src/lib/rentalFulfillment";
import { isBookingEmailConfigured, missingBookingEmailSettings } from "@/src/lib/server/bookingStatusEmail";
import { resolveBookingRecipientEmail } from "@/src/lib/server/bookingRecipient";
import { safeTagValue, sendEmail, type EmailSendResult } from "@/src/lib/server/emailTransport";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById, getCustomerRewardProgress } from "@/src/services/bookingService";

export interface CompletionEmailOutcome {
  sent: boolean;
  emailedTo?: string;
  reason?: EmailSendResult["reason"] | "not_found" | "not_completed" | "load_failed";
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Sends the Rental Completed email and saves when and where it went. Never throws: the rental is
 * already Completed by the time this runs, so a failure is logged and returned so the admin can
 * use Resend Email. The first send uses a stable delivery key so a retried request cannot email
 * the customer twice.
 */
export async function sendRentalCompletedEmail({
  bookingId,
  origin,
  resend = false,
}: {
  bookingId: string;
  origin: string;
  resend?: boolean;
}): Promise<CompletionEmailOutcome> {
  try {
    const missingSettings = missingBookingEmailSettings();
    if (!isBookingEmailConfigured() || missingSettings.length > 0) {
      console.error("Booking emails are not configured. Set the missing server settings.", { missingSettings });
      return { sent: false, reason: "not_configured" };
    }

    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);
    if (!booking) return { sent: false, reason: "not_found" };
    if (booking.status !== "returned") return { sent: false, reason: "not_completed" };

    const [paymentsResult, chargesResult] = await Promise.all([
      admin.from("booking_payment_submissions").select("declared_amount, status").eq("booking_id", bookingId),
      admin.from("booking_charges").select("*").eq("booking_id", bookingId),
    ]);
    if (paymentsResult.error || chargesResult.error) {
      console.error("Completion email could not load payments or charges", {
        bookingId,
        error: paymentsResult.error?.message ?? chargesResult.error?.message,
      });
      return { sent: false, reason: "load_failed" };
    }

    const verifiedPaid = (paymentsResult.data ?? [])
      .filter((row) => row.status === "verified")
      .reduce((sum, row) => sum + row.declared_amount, 0);
    const charges = activeCharges((chargesResult.data ?? []).map(mapCharge));
    const chargesTotal = charges.reduce((sum, charge) => sum + charge.amount, 0);
    const paidCharges = charges
      .filter((charge) => charge.paymentStatus === "paid")
      .reduce((sum, charge) => sum + charge.amount, 0);
    const totalPaid = round2(verifiedPaid + paidCharges);
    const balance = Math.max(0, round2(booking.totalAmount + chargesTotal - totalPaid));

    let loyalty: LoyaltyEmailOutcome = { kind: "none" };
    if (!booking.isGuestCheckout) {
      try {
        const progress = await getCustomerRewardProgress(admin, booking.customerId);
        loyalty = getLoyaltyEmailOutcome({
          isGuest: false,
          completedRentals: progress.completedRentals,
          loyaltyRewardUsed: progress.loyaltyRewardUsed,
          thisBookingRewardAmount: booking.loyaltyDiscountAmount,
        });
      } catch (error) {
        // The email is still worth sending without a loyalty section.
        console.error("Completion email could not load loyalty progress", {
          bookingId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const customerEmail = await resolveBookingRecipientEmail(admin, booking);
    const email = buildRentalCompletedEmail({
      bookingId: booking.id,
      bookingReference: booking.bookingRef,
      customerName: booking.customerSnapshot.fullName.trim() || "Customer",
      customerEmail,
      items: booking.items.map((item) => ({ name: item.productName, quantity: item.quantity })),
      completedAt: booking.returnedAt ?? booking.updatedAt,
      bookingUrl: `${origin}${bookingTrackingPath(booking.id, booking.isGuestCheckout)}`,
      isGuest: booking.isGuestCheckout,
      rentalTotal: booking.totalAmount,
      charges: charges.map((charge) => ({ label: CHARGE_TYPE_LABELS[charge.chargeType], amount: charge.amount })),
      totalPaid,
      balance,
      loyalty,
    });

    const result = await sendEmail({
      to: customerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: resend
        ? `booking-completed-resend-${booking.id}-${Date.now()}`
        : `booking-completed-${booking.id}`,
      tags: [
        { name: "booking_status", value: "completed" },
        { name: "booking_reference", value: safeTagValue(booking.bookingRef) },
      ],
      logContext: { bookingId: booking.id, status: "completed" },
    });
    if (!result.sent) return { sent: false, reason: result.reason };

    const { error: saveError } = await admin
      .from("bookings")
      .update({ completion_email_sent_at: new Date().toISOString(), completion_email_to: customerEmail })
      .eq("id", bookingId);
    if (saveError) {
      console.error("Completion email status could not be saved", { bookingId, error: saveError.message });
    }
    return { sent: true, emailedTo: customerEmail };
  } catch (error) {
    console.error("Completion email failed unexpectedly", {
      bookingId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { sent: false, reason: "load_failed" };
  }
}
```

- [ ] **Step 7: Add the Customer Update sender**

Create `src/lib/server/customerUpdateEmail.ts`:

```ts
import "server-only";

import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { buildCustomerUpdateEmail } from "@/src/lib/customerUpdateEmailContent";
import { mapCharge } from "@/src/lib/fulfillmentMappers";
import { CHARGE_TYPE_LABELS } from "@/src/lib/rentalFulfillment";
import { resolveBookingRecipientEmail } from "@/src/lib/server/bookingRecipient";
import { safeTagValue, sendEmail, type EmailSendResult } from "@/src/lib/server/emailTransport";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";

export interface CustomerUpdateDeliveryOutcome {
  delivered: boolean;
  emailedTo?: string;
  reason?: EmailSendResult["reason"] | "not_found" | "already_sent" | "load_failed";
}

/**
 * Emails one stored customer update and records the attempt on the same row. Used for the first
 * send and for every resend, so a retry never creates a second update or touches any charge.
 * Never throws.
 */
export async function deliverCustomerUpdate({
  updateId,
  origin,
}: {
  updateId: string;
  origin: string;
}): Promise<CustomerUpdateDeliveryOutcome> {
  try {
    const admin = createAdminClient();
    const { data: update, error } = await admin
      .from("booking_customer_updates")
      .select("*")
      .eq("id", updateId)
      .maybeSingle();
    if (error) {
      console.error("Customer update could not be loaded", { updateId, error: error.message });
      return { delivered: false, reason: "load_failed" };
    }
    if (!update) return { delivered: false, reason: "not_found" };
    if (update.delivery_status === "sent") return { delivered: false, reason: "already_sent" };

    const booking = await getBookingById(admin, update.booking_id);
    if (!booking) return { delivered: false, reason: "not_found" };

    let charge: { label: string; amount: number; paid: boolean } | undefined;
    if (update.related_charge_id) {
      const { data: chargeRow } = await admin
        .from("booking_charges")
        .select("*")
        .eq("id", update.related_charge_id)
        .eq("booking_id", update.booking_id)
        .maybeSingle();
      if (chargeRow) {
        const mapped = mapCharge(chargeRow);
        charge = {
          label: CHARGE_TYPE_LABELS[mapped.chargeType],
          amount: mapped.amount,
          paid: mapped.paymentStatus === "paid",
        };
      }
    }

    const customerEmail = await resolveBookingRecipientEmail(admin, booking);
    const email = buildCustomerUpdateEmail({
      bookingReference: booking.bookingRef,
      customerName: booking.customerSnapshot.fullName.trim() || "Customer",
      subject: update.subject,
      message: update.message,
      bookingUrl: `${origin}${bookingTrackingPath(booking.id, booking.isGuestCheckout)}`,
      isGuest: booking.isGuestCheckout,
      charge,
    });

    const attempt = update.delivery_attempts + 1;
    const result = await sendEmail({
      to: customerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `booking-update-${update.id}-${attempt}`,
      tags: [
        { name: "booking_status", value: "customer_update" },
        { name: "booking_reference", value: safeTagValue(booking.bookingRef) },
      ],
      logContext: { bookingId: booking.id, updateId: update.id },
    });

    const now = new Date().toISOString();
    const { error: saveError } = await admin
      .from("booking_customer_updates")
      .update({
        delivery_attempts: attempt,
        first_attempt_at: update.first_attempt_at ?? now,
        last_attempt_at: now,
        ...(result.sent ? { delivery_status: "sent", sent_at: now, sent_to: customerEmail } : {}),
      })
      .eq("id", update.id);
    if (saveError) {
      console.error("Customer update result could not be saved", { updateId, error: saveError.message });
    }

    return result.sent
      ? { delivered: true, emailedTo: customerEmail }
      : { delivered: false, reason: result.reason };
  } catch (error) {
    console.error("Customer update failed unexpectedly", {
      updateId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { delivered: false, reason: "load_failed" };
  }
}
```

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run test:bookings`
Expected: PASS (the existing email builder tests are unaffected).

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/fulfillmentMappers.ts src/lib/server/
git commit -m "feat: record approval email outcome and add completion and update emails"
```

### Task 5: API routes and PATCH guard

**Files:**
- Create: `src/lib/fulfillmentApiHelpers.ts`
- Create: `scripts/testFulfillmentApi.ts`
- Modify: `package.json` (`test:fulfillment`)
- Create: `src/lib/server/adminRouteErrors.ts`
- Create: `src/lib/server/fulfillmentServer.ts`
- Create: `app/api/admin/bookings/[bookingId]/fulfillment/route.ts`
- Create: `app/api/admin/bookings/[bookingId]/charges/route.ts`
- Create: `app/api/admin/bookings/[bookingId]/charges/[chargeId]/route.ts`
- Create: `app/api/admin/bookings/[bookingId]/customer-updates/route.ts`
- Create: `app/api/admin/bookings/[bookingId]/customer-updates/[updateId]/route.ts`
- Create: `app/api/admin/bookings/[bookingId]/complete/route.ts`
- Create: `app/api/admin/bookings/[bookingId]/completion-email/route.ts`
- Modify: `app/api/admin/bookings/[bookingId]/route.ts`

**Interfaces:**
- Consumes: Task 1 (`getCompletionBlockers`, `CompletionInput`, `PAYMENT_AWAITING_REVIEW_STATUSES`), Task 3 (RPCs), Task 4 (`sendRentalCompletedEmail`, `deliverCustomerUpdate`, `mapCharge`, `mapFulfillmentRecord`).
- Produces (HTTP, all `POST`/`PATCH` JSON, admin only, errors are `{ error: string }`):
  - `POST /api/admin/bookings/:id/fulfillment` body `{ action: "pickup" | "return"; at: ISO string; notes?: string }` or `{ action: "condition"; condition: "good" | "damaged"; notes?: string; photoPaths?: string[] }` returns `{ success: true }`
  - `POST /api/admin/bookings/:id/charges` body `{ chargeType; amount: number; reason: string }` returns `{ success: true; chargeId: string }`
  - `PATCH /api/admin/bookings/:id/charges/:chargeId` body `{ action: "mark_paid"; method; paidAt: ISO }` or `{ action: "void"; reason }` returns `{ success: true }`
  - `POST /api/admin/bookings/:id/customer-updates` body `{ subject; message; adminNote?; relatedChargeId? }` returns `{ success: true; updateId: string; delivered: boolean; emailedTo?: string }`
  - `POST /api/admin/bookings/:id/customer-updates/:updateId` (resend) returns `{ success: true; delivered: boolean; emailedTo?: string }`
  - `POST /api/admin/bookings/:id/complete` body `{ note?: string }` returns `{ success: true; alreadyCompleted: boolean; emailSent: boolean }`; 409 responses may carry `blockers: string[]`
  - `POST /api/admin/bookings/:id/completion-email` returns `{ success: true; emailedTo: string }`
  - `PATCH /api/admin/bookings/:id` with `status: "returned"` now returns 409

- [ ] **Step 1: Write the failing tests for the pure helpers**

Create `scripts/testFulfillmentApi.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  isUuid,
  mapFulfillmentRpcError,
  parseIsoDate,
} from "../src/lib/fulfillmentApiHelpers";

test("uuid check accepts real ids and rejects anything else", () => {
  assert.equal(isUuid("3f2b8c1e-9d4a-4c1b-8a5e-1b2c3d4e5f60"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(undefined), false);
});

test("dates must be real ISO-style values", () => {
  assert.equal(parseIsoDate("2026-09-21T02:30:00.000Z"), "2026-09-21T02:30:00.000Z");
  assert.equal(parseIsoDate("garbage"), null);
  assert.equal(parseIsoDate(42), null);
  assert.equal(parseIsoDate("1999-01-01T00:00:00.000Z"), null);
});

test("text is trimmed, capped and never non-string", () => {
  assert.equal(cleanText("  hello  ", 10), "hello");
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(cleanText(12, 10), "");
  assert.equal(cleanText(undefined, 10), "");
});

test("database error codes become friendly messages with the right status", () => {
  assert.deepEqual(mapFulfillmentRpcError("BALANCE_PAYMENT_REQUIRED"), {
    status: 409,
    message: "The remaining balance must be settled before pickup can be confirmed.",
  });
  assert.equal(mapFulfillmentRpcError("error: PICKUP_NOT_READY (P0001)")?.status, 409);
  assert.equal(mapFulfillmentRpcError("NOT_AUTHORIZED")?.status, 403);
  assert.equal(mapFulfillmentRpcError("CHARGE_NOT_FOUND")?.status, 404);
  assert.equal(mapFulfillmentRpcError("DAMAGE_NOTES_REQUIRED")?.status, 400);
  assert.equal(mapFulfillmentRpcError("something unexpected"), null);
});

test("no friendly message leaks a raw error code", () => {
  for (const code of ["COMPLETION_BLOCKED", "INVALID_DATE", "RENTAL_COMPLETED", "REASON_REQUIRED"]) {
    const mapped = mapFulfillmentRpcError(code);
    assert.ok(mapped, `${code} should be mapped`);
    assert.ok(!/[A-Z]{4,}_[A-Z_]+/.test(mapped.message));
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test scripts/testFulfillmentApi.ts`
Expected: FAIL with "Cannot find module '../src/lib/fulfillmentApiHelpers'".

- [ ] **Step 3: Implement the helpers**

Create `src/lib/fulfillmentApiHelpers.ts`:

```ts
export interface ApiError {
  message: string;
  status: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Returns a normalized ISO string for a plausible date, otherwise null. */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return parsed.toISOString();
}

/** Trimmed string capped at maxLength. Anything that is not a string becomes "". */
export function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const RPC_ERRORS: [code: string, error: ApiError][] = [
  ["NOT_AUTHORIZED", { status: 403, message: "Active administrator access is required." }],
  ["BOOKING_NOT_FOUND", { status: 404, message: "The selected booking no longer exists." }],
  ["PICKUP_NOT_READY", { status: 409, message: "The booking must be Ready for Handover before pickup can be recorded." }],
  ["BALANCE_PAYMENT_REQUIRED", { status: 409, message: "The remaining balance must be settled before pickup can be confirmed." }],
  ["INVALID_STATUS_TRANSITION", { status: 409, message: "That action is not available for the booking's current status." }],
  ["RETURN_NOT_READY", { status: 409, message: "Record the pickup first, then the return." }],
  ["RETURN_BEFORE_PICKUP", { status: 400, message: "The return time cannot be earlier than the pickup time." }],
  ["CONDITION_NOT_READY", { status: 409, message: "The item condition can be recorded once the item has been picked up." }],
  ["INVALID_CONDITION", { status: 400, message: "Choose Good Condition or Has Damage." }],
  ["DAMAGE_NOTES_REQUIRED", { status: 400, message: "Describe the damage in the admin notes." }],
  ["TOO_MANY_PHOTOS", { status: 400, message: "You can attach up to 6 photos." }],
  ["INVALID_PHOTO_PATH", { status: 400, message: "One of the photos does not belong to this booking." }],
  ["INVALID_DATE", { status: 400, message: "Enter a valid date and time that is not in the future." }],
  ["CHARGE_NOT_ALLOWED", { status: 409, message: "Charges can be added once the booking is confirmed." }],
  ["INVALID_CHARGE_TYPE", { status: 400, message: "Choose Late Fee, Damage Fee or Other." }],
  ["INVALID_AMOUNT", { status: 400, message: "Enter an amount greater than zero." }],
  ["REASON_REQUIRED", { status: 400, message: "Add a short reason (at least 3 characters)." }],
  ["CHARGE_NOT_FOUND", { status: 404, message: "That charge no longer exists." }],
  ["CHARGE_VOIDED", { status: 409, message: "That charge has already been voided." }],
  ["CHARGE_ALREADY_PAID", { status: 409, message: "That charge is already marked as paid." }],
  ["INVALID_METHOD", { status: 400, message: "Choose Cash, GCash or Other." }],
  ["RENTAL_COMPLETED", { status: 409, message: "Charges can no longer be changed on a completed or closed booking." }],
  ["COMPLETION_BLOCKED", { status: 409, message: "This rental cannot be completed yet. Refresh the page and check the Complete Rental tab." }],
];

/** Maps a database error message (which contains one of our codes) to a friendly message. */
export function mapFulfillmentRpcError(message: string): ApiError | null {
  for (const [code, error] of RPC_ERRORS) {
    if (message.includes(code)) return error;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass, and register the test file**

Run: `npx tsx --test scripts/testFulfillmentApi.ts`
Expected: PASS, 5 tests.

In `package.json`, change the script to include all three files:

```json
    "test:fulfillment": "tsx --test scripts/testRentalFulfillment.ts scripts/testFulfillmentEmails.ts scripts/testFulfillmentApi.ts",
```

Run: `npm run test:fulfillment`
Expected: PASS (27 tests).

- [ ] **Step 5: Add the shared route error helpers**

Create `src/lib/server/adminRouteErrors.ts`:

```ts
import "server-only";

import { NextResponse } from "next/server";
import { mapFulfillmentRpcError } from "@/src/lib/fulfillmentApiHelpers";
import { RequestSecurityError } from "@/src/lib/server/requestSecurity";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Known database codes become friendly messages; anything else is logged and made generic. */
export function rpcErrorResponse(error: { message?: string } | null, fallback: string, logLabel: string) {
  const mapped = mapFulfillmentRpcError(error?.message ?? "");
  if (mapped) return jsonError(mapped.message, mapped.status);
  console.error(logLabel, error);
  return jsonError(fallback, 500);
}

export function routeFailureResponse(error: unknown, fallback: string, logLabel: string) {
  if (error instanceof RequestSecurityError) return jsonError(error.message, error.status);
  console.error(logLabel, error);
  return jsonError(fallback, 500);
}
```

- [ ] **Step 6: Add the server-side completion inputs loader**

Create `src/lib/server/fulfillmentServer.ts`:

```ts
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCharge, mapFulfillmentRecord } from "@/src/lib/fulfillmentMappers";
import { PAYMENT_AWAITING_REVIEW_STATUSES, type CompletionInput } from "@/src/lib/rentalFulfillment";
import type { Database } from "@/src/lib/supabase/database.types";
import { getBookingById } from "@/src/services/bookingService";

/** Loads everything getCompletionBlockers needs. Returns null when the booking does not exist. */
export async function loadCompletionInputs(
  admin: SupabaseClient<Database>,
  bookingId: string,
): Promise<CompletionInput | null> {
  const booking = await getBookingById(admin, bookingId);
  if (!booking) return null;

  const [recordResult, chargesResult, paymentsResult] = await Promise.all([
    admin.from("booking_fulfillment_records").select("*").eq("booking_id", bookingId).maybeSingle(),
    admin.from("booking_charges").select("*").eq("booking_id", bookingId),
    admin.from("booking_payment_submissions").select("declared_amount, status").eq("booking_id", bookingId),
  ]);
  if (recordResult.error || chargesResult.error || paymentsResult.error) {
    throw new Error(
      recordResult.error?.message ?? chargesResult.error?.message ?? paymentsResult.error?.message ?? "load failed",
    );
  }

  const record = recordResult.data ? mapFulfillmentRecord(recordResult.data) : null;
  const payments = paymentsResult.data ?? [];
  return {
    status: booking.status,
    returned: record?.returned ?? false,
    itemCondition: record?.itemCondition ?? null,
    charges: (chargesResult.data ?? []).map(mapCharge),
    totalAmount: booking.totalAmount,
    verifiedPaid: payments.filter((row) => row.status === "verified").reduce((sum, row) => sum + row.declared_amount, 0),
    pendingPaymentReviews: payments.filter((row) =>
      (PAYMENT_AWAITING_REVIEW_STATUSES as readonly string[]).includes(row.status),
    ).length,
  };
}
```

- [ ] **Step 7: Add the pickup / return / condition route**

Create `app/api/admin/bookings/[bookingId]/fulfillment/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cleanText, isUuid, parseIsoDate } from "@/src/lib/fulfillmentApiHelpers";
import { jsonError, routeFailureResponse, rpcErrorResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The update could not be saved. Please try again.";

/** Records pickup, return, or item condition for a booking. */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-fulfillment", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const notes = cleanText(body?.notes, 1000);

    if (body?.action === "pickup" || body?.action === "return") {
      const at = parseIsoDate(body.at);
      if (!at) return jsonError("Enter a valid date and time.", 400);
      const { error } =
        body.action === "pickup"
          ? await supabase.rpc("admin_record_pickup", {
              p_booking_id: bookingId,
              p_picked_up_at: at,
              p_notes: notes || undefined,
            })
          : await supabase.rpc("admin_record_return", {
              p_booking_id: bookingId,
              p_returned_at: at,
              p_notes: notes || undefined,
            });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin pickup/return update failed");
      return NextResponse.json({ success: true });
    }

    if (body?.action === "condition") {
      if (body.condition !== "good" && body.condition !== "damaged") {
        return jsonError("Choose Good Condition or Has Damage.", 400);
      }
      const photoPaths = Array.isArray(body.photoPaths)
        ? body.photoPaths.filter((path): path is string => typeof path === "string")
        : [];
      const { error } = await supabase.rpc("admin_save_item_condition", {
        p_booking_id: bookingId,
        p_condition: body.condition,
        p_notes: notes || undefined,
        p_photo_paths: photoPaths,
      });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin item condition update failed");
      return NextResponse.json({ success: true });
    }

    return jsonError("Choose a valid fulfillment action.", 400);
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin fulfillment update failed");
  }
}
```

- [ ] **Step 8: Add the charges routes**

Create `app/api/admin/bookings/[bookingId]/charges/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cleanText, isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { jsonError, routeFailureResponse, rpcErrorResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The charge could not be added. Please try again.";

/** Adds an extra charge. The admin types every amount; nothing is calculated automatically. */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-charge", 20, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const amount = typeof body?.amount === "number" ? body.amount : Number.NaN;
    if (!Number.isFinite(amount)) return jsonError("Enter an amount greater than zero.", 400);

    const { data, error } = await supabase.rpc("admin_add_booking_charge", {
      p_booking_id: bookingId,
      p_charge_type: typeof body?.chargeType === "string" ? body.chargeType : "",
      p_amount: amount,
      p_reason: cleanText(body?.reason, 500),
    });
    if (error || !data) return rpcErrorResponse(error, FAILURE, "Admin add charge failed");
    return NextResponse.json({ success: true, chargeId: data.id });
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin add charge failed");
  }
}
```

Create `app/api/admin/bookings/[bookingId]/charges/[chargeId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cleanText, isUuid, parseIsoDate } from "@/src/lib/fulfillmentApiHelpers";
import { jsonError, routeFailureResponse, rpcErrorResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The charge could not be updated. Please try again.";

/** Marks a charge as paid, or voids it. Charges are never deleted. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookingId: string; chargeId: string }> },
) {
  try {
    enforceRateLimit(request, "admin-booking-charge-update", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId, chargeId } = await params;
    if (!isUuid(bookingId) || !isUuid(chargeId)) return jsonError("That charge could not be found.", 404);

    const { data: charge } = await supabase
      .from("booking_charges")
      .select("id")
      .eq("id", chargeId)
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (!charge) return jsonError("That charge could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (body?.action === "mark_paid") {
      const paidAt = parseIsoDate(body.paidAt);
      if (!paidAt) return jsonError("Enter a valid date and time.", 400);
      const { error } = await supabase.rpc("admin_mark_charge_paid", {
        p_charge_id: chargeId,
        p_method: typeof body.method === "string" ? body.method : "",
        p_paid_at: paidAt,
      });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin mark charge paid failed");
      return NextResponse.json({ success: true });
    }

    if (body?.action === "void") {
      const { error } = await supabase.rpc("admin_void_booking_charge", {
        p_charge_id: chargeId,
        p_reason: cleanText(body.reason, 500),
      });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin void charge failed");
      return NextResponse.json({ success: true });
    }

    return jsonError("Choose a valid charge action.", 400);
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin charge update failed");
  }
}
```

- [ ] **Step 9: Add the customer update routes**

Create `app/api/admin/bookings/[bookingId]/customer-updates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cleanText, isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { deliverCustomerUpdate } from "@/src/lib/server/customerUpdateEmail";
import { jsonError, routeFailureResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The message could not be sent. Please try again.";
const ALLOWED_STATUSES = ["approved", "confirmed", "ready_for_release", "released", "returned"];

/**
 * Saves a customer update, then emails it. The update is kept even when the email fails, so the
 * admin can resend the same message from the history without creating a second record.
 */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-customer-update", 10, 60_000);
    const { user } = await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const subject = cleanText(body?.subject, 150);
    const message = cleanText(body?.message, 5000);
    const adminNote = cleanText(body?.adminNote, 1000);
    if (!subject) return jsonError("Add a subject for the message.", 400);
    if (!message) return jsonError("Write a message before sending.", 400);

    const admin = createAdminClient();
    const { data: booking } = await admin.from("bookings").select("id, status").eq("id", bookingId).maybeSingle();
    if (!booking) return jsonError("The selected booking could not be found.", 404);
    if (!ALLOWED_STATUSES.includes(booking.status)) {
      return jsonError("Customer updates are available after the booking is approved.", 409);
    }

    let relatedChargeId: string | null = null;
    if (body?.relatedChargeId !== undefined && body.relatedChargeId !== null) {
      if (!isUuid(body.relatedChargeId)) return jsonError("That charge could not be found.", 404);
      const { data: charge } = await admin
        .from("booking_charges")
        .select("id")
        .eq("id", body.relatedChargeId)
        .eq("booking_id", bookingId)
        .maybeSingle();
      if (!charge) return jsonError("That charge could not be found.", 404);
      relatedChargeId = charge.id;
    }

    const { data: created, error } = await admin
      .from("booking_customer_updates")
      .insert({
        booking_id: bookingId,
        subject,
        message,
        admin_note: adminNote || null,
        related_charge_id: relatedChargeId,
        sent_by: user.id,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("Customer update could not be saved", error);
      return jsonError(FAILURE, 500);
    }

    const outcome = await deliverCustomerUpdate({ updateId: created.id, origin: new URL(request.url).origin });
    return NextResponse.json({
      success: true,
      updateId: created.id,
      delivered: outcome.delivered,
      emailedTo: outcome.emailedTo,
    });
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin customer update failed");
  }
}
```

Create `app/api/admin/bookings/[bookingId]/customer-updates/[updateId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { deliverCustomerUpdate } from "@/src/lib/server/customerUpdateEmail";
import { jsonError, routeFailureResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The message could not be sent. Please try again.";

/** Resends a saved customer update that has not been delivered. Reuses the same row. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookingId: string; updateId: string }> },
) {
  try {
    enforceRateLimit(request, "admin-customer-update-resend", 10, 60_000);
    await requireActiveAdmin();
    const { bookingId, updateId } = await params;
    if (!isUuid(bookingId) || !isUuid(updateId)) return jsonError("That message could not be found.", 404);

    const admin = createAdminClient();
    const { data: update } = await admin
      .from("booking_customer_updates")
      .select("id")
      .eq("id", updateId)
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (!update) return jsonError("That message could not be found.", 404);

    const outcome = await deliverCustomerUpdate({ updateId, origin: new URL(request.url).origin });
    if (outcome.reason === "already_sent") return jsonError("That message was already sent.", 409);
    if (outcome.reason === "invalid_recipient") {
      return jsonError("The customer does not have a valid email address on this booking.", 422);
    }
    return NextResponse.json({ success: true, delivered: outcome.delivered, emailedTo: outcome.emailedTo });
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin customer update resend failed");
  }
}
```

- [ ] **Step 10: Add the Complete Rental and completion email routes**

Create `app/api/admin/bookings/[bookingId]/complete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cleanText, isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { getCompletionBlockers } from "@/src/lib/rentalFulfillment";
import { jsonError, routeFailureResponse, rpcErrorResponse } from "@/src/lib/server/adminRouteErrors";
import { loadCompletionInputs } from "@/src/lib/server/fulfillmentServer";
import { sendRentalCompletedEmail } from "@/src/lib/server/rentalCompletedEmail";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The rental could not be completed. Please try again.";

/**
 * Completes a rental. Safe to call again: an already completed booking is left as is, and the
 * Rental Completed email is only sent if it has not gone out yet. A failed email never undoes
 * the completion; the admin uses Resend Email.
 */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-complete", 10, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const note = cleanText(body?.note, 1000);

    const admin = createAdminClient();
    const inputs = await loadCompletionInputs(admin, bookingId);
    if (!inputs) return jsonError("The selected booking could not be found.", 404);

    const alreadyCompleted = inputs.status === "returned";
    if (!alreadyCompleted) {
      const blockers = getCompletionBlockers(inputs);
      if (blockers.length) {
        return NextResponse.json({ error: "This rental cannot be completed yet.", blockers }, { status: 409 });
      }
      const { error } = await supabase.rpc("admin_complete_rental", {
        p_booking_id: bookingId,
        p_note: note || undefined,
      });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin complete rental failed");
    }

    const { data: emailState } = await admin
      .from("bookings")
      .select("completion_email_sent_at")
      .eq("id", bookingId)
      .maybeSingle();

    let emailSent = Boolean(emailState?.completion_email_sent_at);
    if (!emailSent) {
      const outcome = await sendRentalCompletedEmail({ bookingId, origin: new URL(request.url).origin });
      emailSent = outcome.sent;
    }

    return NextResponse.json({ success: true, alreadyCompleted, emailSent });
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin complete rental failed");
  }
}
```

Create `app/api/admin/bookings/[bookingId]/completion-email/route.ts`:

```ts
import { NextResponse } from "next/server";
import { isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { jsonError, routeFailureResponse } from "@/src/lib/server/adminRouteErrors";
import { sendRentalCompletedEmail } from "@/src/lib/server/rentalCompletedEmail";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The completion email could not be sent. Please try again.";

/** Admin "Resend Email" for a completed rental. */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-completion-email", 10, 60_000);
    await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const outcome = await sendRentalCompletedEmail({
      bookingId,
      origin: new URL(request.url).origin,
      resend: true,
    });
    if (outcome.sent) return NextResponse.json({ success: true, emailedTo: outcome.emailedTo ?? "" });

    if (outcome.reason === "not_found") return jsonError("The selected booking could not be found.", 404);
    if (outcome.reason === "not_completed") {
      return jsonError("The completion email is available after the rental is completed.", 409);
    }
    if (outcome.reason === "invalid_recipient") {
      return jsonError("The customer does not have a valid email address on this booking.", 422);
    }
    return jsonError(FAILURE, 502);
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin completion email failed");
  }
}
```

- [ ] **Step 11: Block the old direct "returned" transition**

In `app/api/admin/bookings/[bookingId]/route.ts`, after the block that validates the note (the `if (NOTE_REQUIRED.has(targetStatus) && !note) { ... }` statement), add:

```ts
    if (targetStatus === "returned") {
      // Completing a rental goes through Complete Rental so its checks and the Rental Completed
      // email always run.
      return errorResponse("Use Complete Rental in the Rental Fulfillment tabs to finish this rental.", 409);
    }
```

- [ ] **Step 12: Verify**

Run: `npx tsc --noEmit`
Expected: PASS. If `data.id` on the `admin_add_booking_charge` result is a type error, confirm Task 3 Step 6 typed that function's `Returns` as the `booking_charges` row.

Run: `npm run lint` and `npm run test:fulfillment`
Expected: both PASS.

- [ ] **Step 13: Commit**

```bash
git add src/lib/fulfillmentApiHelpers.ts scripts/testFulfillmentApi.ts package.json src/lib/server/adminRouteErrors.ts src/lib/server/fulfillmentServer.ts app/api/admin/bookings
git commit -m "feat: add rental fulfillment admin API routes"
```

### Task 6: Client service layer

**Files:**
- Create: `src/services/fulfillmentService.ts`

**Interfaces:**
- Consumes: Task 1 types and `validateConditionPhoto`; Task 4 mappers; Task 5 routes.
- Produces (used by every panel and by `AdminBookingDetail`):
  - `getFulfillmentData(supabase: SupabaseClient<Database>, bookingId: string): Promise<FulfillmentData>` (returns `EMPTY_FULFILLMENT_DATA` with `available: false` when the migration is not applied)
  - `class FulfillmentApiError extends Error { blockers: string[] }`
  - `recordPickup(bookingId, atIso, notes)`, `recordReturn(bookingId, atIso, notes)`: `Promise<void>`
  - `saveItemCondition(bookingId, input: { condition: ItemCondition; notes: string; photoPaths: string[] }): Promise<void>`
  - `addCharge(bookingId, input: { chargeType: ChargeType; amount: number; reason: string }): Promise<string>` (returns the charge id)
  - `markChargePaid(bookingId, chargeId, input: { method: ChargePaymentMethod; paidAt: string }): Promise<void>`
  - `voidCharge(bookingId, chargeId, reason: string): Promise<void>`
  - `sendCustomerUpdate(bookingId, input: { subject: string; message: string; adminNote?: string; relatedChargeId?: string }): Promise<{ updateId: string; delivered: boolean }>`
  - `resendCustomerUpdate(bookingId, updateId): Promise<{ delivered: boolean }>`
  - `completeRental(bookingId, note: string): Promise<{ alreadyCompleted: boolean; emailSent: boolean }>`
  - `resendCompletionEmail(bookingId): Promise<{ emailedTo: string }>`
  - `uploadConditionPhoto(supabase, bookingId, file: File): Promise<string>`, `getConditionPhotoUrl(supabase, path): Promise<string>`
  - `toDateTimeLocalValue(iso?: string): string`, `fromDateTimeLocalValue(value: string): string | null`

- [ ] **Step 1: Create the service**

Create `src/services/fulfillmentService.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCharge, mapCustomerUpdate, mapFulfillmentRecord } from "@/src/lib/fulfillmentMappers";
import { validateConditionPhoto } from "@/src/lib/rentalFulfillment";
import type { Database } from "@/src/lib/supabase/database.types";
import { createSignedUrl, STORAGE_BUCKETS } from "@/src/lib/supabase/storage";
import {
  EMPTY_FULFILLMENT_DATA,
  type ApprovalEmailStatus,
  type ChargePaymentMethod,
  type ChargeType,
  type FulfillmentData,
  type ItemCondition,
} from "@/src/types/fulfillment";

const GENERIC_FAILURE = "That could not be saved. Please try again.";

export class FulfillmentApiError extends Error {
  blockers: string[];
  constructor(message: string, blockers: string[] = []) {
    super(message);
    this.name = "FulfillmentApiError";
    this.blockers = blockers;
  }
}

function toApprovalEmailStatus(value: string | null): ApprovalEmailStatus {
  return value === "sent" || value === "failed" || value === "legacy" ? value : null;
}

/**
 * Loads everything the Rental Fulfillment view needs. If the fulfillment columns or tables are not
 * available yet (migration not applied), it returns "not available" so the old review page keeps
 * working instead of failing to load.
 */
export async function getFulfillmentData(
  supabase: SupabaseClient<Database>,
  bookingId: string,
): Promise<FulfillmentData> {
  const emailResult = await supabase
    .from("bookings")
    .select("approval_email_status, approval_email_sent_at, completion_email_sent_at, completion_email_to")
    .eq("id", bookingId)
    .maybeSingle();
  if (emailResult.error || !emailResult.data) return EMPTY_FULFILLMENT_DATA;

  const [recordResult, chargesResult, updatesResult] = await Promise.all([
    supabase.from("booking_fulfillment_records").select("*").eq("booking_id", bookingId).maybeSingle(),
    supabase.from("booking_charges").select("*").eq("booking_id", bookingId).order("created_at", { ascending: true }),
    supabase
      .from("booking_customer_updates")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false }),
  ]);
  if (recordResult.error || chargesResult.error || updatesResult.error) return EMPTY_FULFILLMENT_DATA;

  const charges = (chargesResult.data ?? []).map(mapCharge);
  const updates = (updatesResult.data ?? []).map(mapCustomerUpdate);

  const adminIds = new Set<string>();
  for (const charge of charges) {
    for (const id of [charge.createdBy, charge.paidRecordedBy, charge.voidedBy]) if (id) adminIds.add(id);
  }
  for (const update of updates) if (update.sentBy) adminIds.add(update.sentBy);

  const adminNames: Record<string, string> = {};
  if (adminIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", [...adminIds]);
    for (const profile of profiles ?? []) {
      if (profile.display_name) adminNames[profile.id] = profile.display_name;
    }
  }

  const email = emailResult.data;
  return {
    available: true,
    email: {
      approvalEmailStatus: toApprovalEmailStatus(email.approval_email_status),
      approvalEmailSentAt: email.approval_email_sent_at ?? undefined,
      completionEmailSentAt: email.completion_email_sent_at ?? undefined,
      completionEmailTo: email.completion_email_to ?? undefined,
    },
    record: recordResult.data ? mapFulfillmentRecord(recordResult.data) : null,
    charges,
    updates,
    adminNames,
  };
}

async function callApi<T>(url: string, method: "POST" | "PATCH", body: unknown, fallback = GENERIC_FAILURE): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    // A dropped connection would otherwise surface the browser's raw "Failed to fetch".
    throw new FulfillmentApiError(fallback);
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: unknown; blockers?: unknown })
    | null;
  if (!response.ok) {
    const blockers = Array.isArray(payload?.blockers)
      ? payload.blockers.filter((item): item is string => typeof item === "string")
      : [];
    throw new FulfillmentApiError(typeof payload?.error === "string" ? payload.error : fallback, blockers);
  }
  return (payload ?? {}) as T;
}

const base = (bookingId: string) => `/api/admin/bookings/${encodeURIComponent(bookingId)}`;

export async function recordPickup(bookingId: string, atIso: string, notes: string): Promise<void> {
  await callApi(`${base(bookingId)}/fulfillment`, "POST", { action: "pickup", at: atIso, notes });
}

export async function recordReturn(bookingId: string, atIso: string, notes: string): Promise<void> {
  await callApi(`${base(bookingId)}/fulfillment`, "POST", { action: "return", at: atIso, notes });
}

export async function saveItemCondition(
  bookingId: string,
  input: { condition: ItemCondition; notes: string; photoPaths: string[] },
): Promise<void> {
  await callApi(`${base(bookingId)}/fulfillment`, "POST", { action: "condition", ...input });
}

export async function addCharge(
  bookingId: string,
  input: { chargeType: ChargeType; amount: number; reason: string },
): Promise<string> {
  const result = await callApi<{ chargeId: string }>(`${base(bookingId)}/charges`, "POST", input);
  return result.chargeId;
}

export async function markChargePaid(
  bookingId: string,
  chargeId: string,
  input: { method: ChargePaymentMethod; paidAt: string },
): Promise<void> {
  await callApi(`${base(bookingId)}/charges/${encodeURIComponent(chargeId)}`, "PATCH", {
    action: "mark_paid",
    ...input,
  });
}

export async function voidCharge(bookingId: string, chargeId: string, reason: string): Promise<void> {
  await callApi(`${base(bookingId)}/charges/${encodeURIComponent(chargeId)}`, "PATCH", { action: "void", reason });
}

export async function sendCustomerUpdate(
  bookingId: string,
  input: { subject: string; message: string; adminNote?: string; relatedChargeId?: string },
): Promise<{ updateId: string; delivered: boolean }> {
  const result = await callApi<{ updateId: string; delivered: boolean }>(
    `${base(bookingId)}/customer-updates`,
    "POST",
    input,
    "The message could not be sent. Please try again.",
  );
  return { updateId: result.updateId, delivered: result.delivered === true };
}

export async function resendCustomerUpdate(bookingId: string, updateId: string): Promise<{ delivered: boolean }> {
  const result = await callApi<{ delivered: boolean }>(
    `${base(bookingId)}/customer-updates/${encodeURIComponent(updateId)}`,
    "POST",
    {},
    "The message could not be sent. Please try again.",
  );
  return { delivered: result.delivered === true };
}

export async function completeRental(
  bookingId: string,
  note: string,
): Promise<{ alreadyCompleted: boolean; emailSent: boolean }> {
  const result = await callApi<{ alreadyCompleted: boolean; emailSent: boolean }>(
    `${base(bookingId)}/complete`,
    "POST",
    { note },
    "The rental could not be completed. Please try again.",
  );
  return { alreadyCompleted: result.alreadyCompleted === true, emailSent: result.emailSent === true };
}

export async function resendCompletionEmail(bookingId: string): Promise<{ emailedTo: string }> {
  const result = await callApi<{ emailedTo?: string }>(
    `${base(bookingId)}/completion-email`,
    "POST",
    {},
    "The completion email could not be sent. Please try again.",
  );
  return { emailedTo: result.emailedTo || "the customer" };
}

/** Uploads one condition photo to the private bucket and returns its storage path. */
export async function uploadConditionPhoto(
  supabase: SupabaseClient<Database>,
  bookingId: string,
  file: File,
): Promise<string> {
  const problem = validateConditionPhoto(file);
  if (problem) throw new FulfillmentApiError(problem);

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${bookingId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKETS.conditionPhotos)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new FulfillmentApiError("The photo could not be uploaded. Please try again.");
  return path;
}

export function getConditionPhotoUrl(supabase: SupabaseClient<Database>, path: string): Promise<string> {
  return createSignedUrl(supabase, STORAGE_BUCKETS.conditionPhotos, path);
}

/** ISO timestamp to the value a datetime-local input expects, in the admin's own timezone. */
export function toDateTimeLocalValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** datetime-local input value back to an ISO timestamp, or null when it is empty or invalid. */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS. If `profile.display_name` is a type error, open the `profiles` `Row` block in `database.types.ts` and use the actual name column it defines.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/fulfillmentService.ts
git commit -m "feat: add rental fulfillment client service"
```

### Task 7: Shared fulfillment styles and formatting

**Files:**
- Create: `components/admin/fulfillment/fulfillment.module.css`
- Create: `components/admin/fulfillment/format.ts`

**Interfaces:**
- Produces: `formatDateTime(value?: string | null): string`, `formatDay(value?: string | null): string` (Asia/Manila, `-` when empty), and the CSS classes used by every panel: `panel`, `panelHeader`, `fieldGrid`, `field`, `actions`, `notice`, `noticeWarning`, `noticeSuccess`, `pill`, `pillDone`, `pillPending`, `facts`, `tabs`, `tab`, `tabActive`, `tabState`, `strip`, `stripItem`, `stripBody`, `banner`, `chargeList`, `chargeCard`, `chargeVoided`, `chargeMeta`, `history`, `historyItem`, `checklist`, `checkItem`, `checkDone`, `checkBlocked`, `photoGrid`, `photoThumb`, `previewFrame`, `recordToggle`, `recordSection`, `recordGrid`, `emptyText`.

- [ ] **Step 1: Create the formatting helpers**

Create `components/admin/fulfillment/format.ts`:

```ts
const MANILA = "Asia/Manila";

export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-PH", {
    timeZone: MANILA,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDay(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-PH", { timeZone: MANILA, year: "numeric", month: "short", day: "numeric" });
}
```

- [ ] **Step 2: Create the stylesheet**

Create `components/admin/fulfillment/fulfillment.module.css`. It only uses the existing theme variables from `app/globals.css` and inherits Poppins from the page, and it has no arrow glyphs and no pulsing or "live" styling:

```css
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.35rem;
  border: 1px solid var(--color-light-gray);
  border-radius: 16px;
  background: var(--color-white);
}

.tab {
  display: flex;
  min-height: 44px;
  padding: 0.5rem 0.9rem;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--color-charcoal);
  align-items: center;
  gap: 0.5rem;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.tab:hover {
  background: rgba(215, 165, 165, 0.14);
}

.tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.tabActive {
  border-color: var(--color-dusty-rose);
  background: rgba(215, 165, 165, 0.22);
  color: var(--color-text-primary);
}

.tabState {
  padding: 0.12rem 0.5rem;
  border-radius: 999px;
  background: var(--color-status-yellow-bg);
  color: var(--color-status-yellow);
  font-size: 0.66rem;
  font-weight: 700;
}

.tabStateDone {
  background: var(--color-status-green-bg);
  color: var(--color-status-green);
}

.panel {
  display: flex;
  padding: 1.1rem;
  border: 1px solid var(--color-light-gray);
  border-radius: 18px;
  background: var(--color-white);
  flex-direction: column;
  gap: 1rem;
}

.panelHeader h2 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 1.05rem;
}

.panelHeader p {
  margin: 0.3rem 0 0;
  color: var(--color-charcoal);
  font-size: 0.85rem;
  line-height: 1.55;
}

.fieldGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.85rem;
}

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.35rem;
  color: var(--color-charcoal);
  font-size: 0.8rem;
  font-weight: 600;
}

.field input,
.field select,
.field textarea {
  width: 100%;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--color-light-gray);
  border-radius: var(--radius-control);
  background: var(--color-white);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 0.88rem;
  font-weight: 400;
}

.field textarea {
  min-height: 96px;
  resize: vertical;
}

.field input:focus-visible,
.field select:focus-visible,
.field textarea:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.fieldWide {
  grid-column: 1 / -1;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.notice,
.noticeWarning,
.noticeSuccess {
  margin: 0;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--color-light-gray);
  border-radius: 12px;
  background: rgba(215, 165, 165, 0.1);
  color: var(--color-charcoal);
  font-size: 0.84rem;
  line-height: 1.55;
}

.noticeWarning {
  border-color: var(--color-status-yellow-border);
  background: var(--color-status-yellow-bg);
  color: var(--color-status-yellow);
}

.noticeSuccess {
  border-color: var(--color-status-green-border);
  background: var(--color-status-green-bg);
  color: var(--color-status-green);
}

.pill,
.pillDone,
.pillPending {
  display: inline-flex;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  align-items: center;
  font-size: 0.72rem;
  font-weight: 700;
}

.pill {
  background: rgba(215, 165, 165, 0.2);
  color: var(--color-text-primary);
}

.pillDone {
  background: var(--color-status-green-bg);
  color: var(--color-status-green);
}

.pillPending {
  background: var(--color-status-yellow-bg);
  color: var(--color-status-yellow);
}

.facts {
  display: grid;
  margin: 0;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.75rem;
}

.facts dt {
  color: var(--color-charcoal);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.facts dd {
  margin: 0.2rem 0 0;
  color: var(--color-text-primary);
  font-size: 0.92rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.strip {
  display: flex;
  padding: 1rem;
  border: 1px solid var(--color-status-yellow-border);
  border-radius: 18px;
  background: var(--color-status-yellow-bg);
  flex-direction: column;
  gap: 0.8rem;
}

.strip > h2 {
  margin: 0;
  color: var(--color-status-yellow);
  font-size: 0.95rem;
}

.stripItem {
  display: flex;
  padding: 0.85rem;
  border: 1px solid var(--color-light-gray);
  border-radius: 14px;
  background: var(--color-white);
  flex-direction: column;
  gap: 0.6rem;
}

.stripItem > strong {
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.stripItem > p {
  margin: 0;
  color: var(--color-charcoal);
  font-size: 0.82rem;
  line-height: 1.5;
}

.stripBody {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.banner {
  display: flex;
  padding: 0.85rem 1rem;
  border: 1px solid var(--color-status-yellow-border);
  border-radius: 14px;
  background: var(--color-status-yellow-bg);
  color: var(--color-status-yellow);
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.84rem;
  font-weight: 600;
}

.chargeList {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: 0.7rem;
  list-style: none;
}

.chargeCard {
  display: flex;
  padding: 0.9rem;
  border: 1px solid var(--color-light-gray);
  border-radius: 14px;
  background: var(--color-white);
  flex-direction: column;
  gap: 0.55rem;
}

.chargeVoided {
  background: rgba(36, 36, 36, 0.03);
  color: var(--color-charcoal);
}

.chargeVoided .chargeTitle {
  text-decoration: line-through;
}

.chargeHead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.chargeTitle {
  color: var(--color-text-primary);
  font-size: 0.92rem;
  font-weight: 700;
}

.chargeMeta {
  margin: 0;
  color: var(--color-charcoal);
  font-size: 0.8rem;
  line-height: 1.55;
}

.owedSummary {
  display: flex;
  padding: 0.95rem 1.1rem;
  border: 1px solid var(--color-status-yellow-border);
  border-radius: 14px;
  background: var(--color-status-yellow-bg);
  color: var(--color-status-yellow);
  flex-direction: column;
  gap: 0.2rem;
}

.owedSummaryClear {
  border-color: var(--color-status-green-border);
  background: var(--color-status-green-bg);
  color: var(--color-status-green);
}

.owedSummary strong {
  font-size: 1rem;
}

.owedSummary span {
  font-size: 0.82rem;
}

.history {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: 0.7rem;
  list-style: none;
}

.historyItem {
  display: flex;
  padding: 0.85rem;
  border: 1px solid var(--color-light-gray);
  border-radius: 14px;
  flex-direction: column;
  gap: 0.35rem;
}

.historyItem p {
  margin: 0;
  color: var(--color-charcoal);
  font-size: 0.84rem;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.checklist {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: 0.55rem;
  list-style: none;
}

.checkItem {
  display: flex;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--color-light-gray);
  border-radius: 12px;
  align-items: flex-start;
  gap: 0.6rem;
  font-size: 0.86rem;
  line-height: 1.5;
}

.checkDone {
  border-color: var(--color-status-green-border);
  background: var(--color-status-green-bg);
  color: var(--color-status-green);
}

.checkBlocked {
  border-color: var(--color-status-yellow-border);
  background: var(--color-status-yellow-bg);
  color: var(--color-status-yellow);
}

.photoGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.6rem;
}

.photoThumb {
  display: flex;
  overflow: hidden;
  border: 1px solid var(--color-light-gray);
  border-radius: 12px;
  background: var(--color-white);
  flex-direction: column;
}

.photoThumb img {
  width: 100%;
  height: 96px;
  object-fit: cover;
}

.photoThumb button {
  padding: 0.4rem;
  border: 0;
  border-top: 1px solid var(--color-light-gray);
  background: transparent;
  color: var(--color-danger);
  font: inherit;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
}

.previewFrame {
  width: 100%;
  min-height: 420px;
  border: 1px solid var(--color-light-gray);
  border-radius: 14px;
  background: var(--color-white);
}

.recordToggle {
  align-self: flex-start;
}

.recordSection {
  display: flex;
  padding: 1.1rem;
  border: 1px solid var(--color-light-gray);
  border-radius: 18px;
  background: var(--color-white);
  flex-direction: column;
  gap: 1rem;
}

.recordGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1rem;
}

.recordCard {
  display: flex;
  padding: 0.9rem;
  border: 1px solid var(--color-light-gray);
  border-radius: 14px;
  flex-direction: column;
  gap: 0.6rem;
}

.recordCard h3 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 0.92rem;
}

.emptyText {
  margin: 0;
  color: var(--color-charcoal);
  font-size: 0.84rem;
}

@media (max-width: 640px) {
  .tab {
    flex: 1 1 calc(50% - 0.5rem);
    justify-content: space-between;
  }

  .panel,
  .recordSection {
    padding: 0.9rem;
  }
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/admin/fulfillment/fulfillment.module.css components/admin/fulfillment/format.ts
git commit -m "feat: add shared rental fulfillment styles"
```

### Task 8: Pickup, Return and Item Condition panels

**Files:**
- Create: `components/admin/fulfillment/PickupPanel.tsx`
- Create: `components/admin/fulfillment/ReturnPanel.tsx`
- Create: `components/admin/fulfillment/ItemConditionPanel.tsx`

**Interfaces:**
- Consumes: Task 1 `FulfillmentPanelContext`; Task 6 service functions; Task 7 styles and `formatDateTime`; existing `Button`, `ConfirmModal`, `useToast`, `createClient` (`@/src/lib/supabase/client`).
- Produces:
  - `PickupPanel({ ctx, onOpenCharges, onRequestCancel })` default export
  - `ReturnPanel({ ctx })` default export
  - `ItemConditionPanel({ ctx, onOpenCharges })` default export
  - where `ctx: FulfillmentPanelContext`, `onOpenCharges: () => void`, `onRequestCancel?: () => void`

- [ ] **Step 1: Create the Pickup panel**

Create `components/admin/fulfillment/PickupPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";
import { fromDateTimeLocalValue, recordPickup, toDateTimeLocalValue } from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext } from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

interface PickupPanelProps {
  ctx: FulfillmentPanelContext;
  onOpenCharges: () => void;
  onRequestCancel?: () => void;
}

export default function PickupPanel({ ctx, onOpenCharges, onRequestCancel }: PickupPanelProps) {
  const { showToast } = useToast();
  const record = ctx.data.record;
  const [atValue, setAtValue] = useState(() => toDateTimeLocalValue(ctx.releasedAt));
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pickedUp = record?.pickedUp === true;
  const readyForPickup = ctx.status === "ready_for_release";
  // Released before this feature existed: only the pickup details are missing.
  const missingDetails = ctx.status === "released" && !pickedUp;
  const canRecord = readyForPickup || missingDetails;
  const canCancel = ["approved", "confirmed", "ready_for_release"].includes(ctx.status);
  const blockedByBalance = readyForPickup && !ctx.handoverPaymentReady;

  async function save() {
    const at = fromDateTimeLocalValue(atValue);
    if (!at) {
      showToast("Enter the actual pickup date and time.", "warning");
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    try {
      await recordPickup(ctx.bookingId, at, notes);
      await ctx.onChanged();
      setConfirmOpen(false);
      showToast(readyForPickup ? "Pickup recorded. The customer was notified." : "Pickup details saved.", "success");
    } catch (error) {
      setConfirmOpen(false);
      showToast(error instanceof Error ? error.message : "The pickup could not be recorded.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="pickup-heading">
      <div className={styles.panelHeader}>
        <h2 id="pickup-heading">Pickup</h2>
        <p>Record when the customer received the item.</p>
      </div>

      {pickedUp ? (
        <>
          <p className={styles.noticeSuccess}>The customer has picked up the item.</p>
          <dl className={styles.facts}>
            <div><dt>Actual pickup</dt><dd>{formatDateTime(record?.actualPickupAt)}</dd></div>
            <div><dt>Admin notes</dt><dd>{record?.pickupNotes || "-"}</dd></div>
          </dl>
        </>
      ) : null}

      {!pickedUp && !canRecord ? (
        <p className={styles.notice}>
          {ctx.status === "returned"
            ? "This rental is completed. No pickup was recorded."
            : "Pickup can be recorded once the booking is Ready for Handover. Finish the follow-up items above first."}
        </p>
      ) : null}

      {canRecord ? (
        <>
          {blockedByBalance ? (
            <p className={styles.noticeWarning}>
              The remaining balance must be settled before pickup can be confirmed.{" "}
              <Button variant="none" type="button" onClick={onOpenCharges}>See Charges &amp; Payments</Button>
            </p>
          ) : null}
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Actual pickup date and time</span>
              <input type="datetime-local" value={atValue} onChange={(event) => setAtValue(event.target.value)} disabled={busy} />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Admin notes (optional)</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} disabled={busy} placeholder="Who collected the item, what was handed over" />
            </label>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" type="button" onClick={() => setConfirmOpen(true)} disabled={busy || blockedByBalance}>
              {readyForPickup ? "Mark as Picked Up" : "Save pickup details"}
            </Button>
          </div>
        </>
      ) : null}

      {canCancel && onRequestCancel ? (
        <div className={styles.actions}>
          <Button variant="danger" type="button" onClick={onRequestCancel}>Cancel Booking</Button>
        </div>
      ) : null}

      {confirmOpen ? (
        <ConfirmModal
          title={readyForPickup ? "Mark as Picked Up?" : "Save pickup details?"}
          description={readyForPickup
            ? `Confirm that the customer picked up the item for booking ${ctx.bookingRef}. The booking will be marked as released to the customer.`
            : `Save the pickup details for booking ${ctx.bookingRef}.`}
          confirmLabel={readyForPickup ? "Yes, Mark as Picked Up" : "Save"}
          busyLabel="Saving..."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void save()}
          busy={busy}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Create the Return panel**

Create `components/admin/fulfillment/ReturnPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { fromDateTimeLocalValue, recordReturn, toDateTimeLocalValue } from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext } from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

export default function ReturnPanel({ ctx }: { ctx: FulfillmentPanelContext }) {
  const { showToast } = useToast();
  const record = ctx.data.record;
  const [atValue, setAtValue] = useState(() => toDateTimeLocalValue());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const returned = record?.returned === true;
  const canRecord = ctx.status === "released" && record?.pickedUp === true && !returned;

  async function save() {
    const at = fromDateTimeLocalValue(atValue);
    if (!at) {
      showToast("Enter the actual return date and time.", "warning");
      return;
    }
    setBusy(true);
    try {
      await recordReturn(ctx.bookingId, at, notes);
      await ctx.onChanged();
      showToast("Return recorded.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The return could not be recorded.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="return-heading">
      <div className={styles.panelHeader}>
        <h2 id="return-heading">Return</h2>
        <p>Record when the item came back. The booking stays open until you complete the rental.</p>
      </div>

      {returned ? (
        <>
          <p className={styles.noticeSuccess}>The item has been returned.</p>
          <dl className={styles.facts}>
            <div><dt>Actual return</dt><dd>{formatDateTime(record?.actualReturnAt)}</dd></div>
            <div><dt>Admin notes</dt><dd>{record?.returnNotes || "-"}</dd></div>
          </dl>
        </>
      ) : null}

      {!returned && !canRecord ? (
        <p className={styles.notice}>
          {ctx.status === "returned"
            ? "This rental is completed."
            : "The return can be recorded after the pickup has been recorded."}
        </p>
      ) : null}

      {canRecord ? (
        <>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Actual return date and time</span>
              <input type="datetime-local" value={atValue} onChange={(event) => setAtValue(event.target.value)} disabled={busy} />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Admin notes (optional)</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} disabled={busy} placeholder="Anything worth remembering about the return" />
            </label>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" type="button" onClick={() => void save()} loading={busy} loadingText="Saving...">
              Mark as Returned
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Create the Item Condition panel**

Create `components/admin/fulfillment/ItemConditionPanel.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { MAX_CONDITION_PHOTOS } from "@/src/lib/rentalFulfillment";
import { createClient } from "@/src/lib/supabase/client";
import {
  getConditionPhotoUrl,
  saveItemCondition,
  uploadConditionPhoto,
} from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext, ItemCondition } from "@/src/types/fulfillment";
import styles from "./fulfillment.module.css";

interface ItemConditionPanelProps {
  ctx: FulfillmentPanelContext;
  onOpenCharges: () => void;
}

export default function ItemConditionPanel({ ctx, onOpenCharges }: ItemConditionPanelProps) {
  const { showToast } = useToast();
  const record = ctx.data.record;
  const [condition, setCondition] = useState<ItemCondition | "">(record?.itemCondition ?? "");
  const [notes, setNotes] = useState(record?.conditionNotes ?? "");
  const [photoPaths, setPhotoPaths] = useState<string[]>(record?.conditionPhotoPaths ?? []);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const editable = ctx.status === "released";
  const saved = record?.itemCondition != null;

  useEffect(() => {
    let cancelled = false;
    const missing = photoPaths.filter((path) => !photoUrls[path]);
    if (missing.length === 0) return;
    const supabase = createClient();
    void Promise.all(
      missing.map(async (path) => {
        try {
          return [path, await getConditionPhotoUrl(supabase, path)] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setPhotoUrls((current) => {
        const next = { ...current };
        for (const entry of entries) if (entry) next[entry[0]] = entry[1];
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [photoPaths, photoUrls]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_CONDITION_PHOTOS - photoPaths.length;
    if (room <= 0) {
      showToast(`You can attach up to ${MAX_CONDITION_PHOTOS} photos.`, "warning");
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        added.push(await uploadConditionPhoto(supabase, ctx.bookingId, file));
      }
      setPhotoPaths((current) => [...current, ...added]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The photo could not be uploaded.", "error");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save() {
    if (!condition) {
      showToast("Choose Good Condition or Has Damage.", "warning");
      return;
    }
    if (condition === "damaged" && !notes.trim()) {
      showToast("Describe the damage in the admin notes.", "warning");
      return;
    }
    setBusy(true);
    try {
      await saveItemCondition(ctx.bookingId, { condition, notes, photoPaths });
      await ctx.onChanged();
      showToast("Item condition saved.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The item condition could not be saved.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="condition-heading">
      <div className={styles.panelHeader}>
        <h2 id="condition-heading">Item Condition</h2>
        <p>Check the item when it comes back and note anything the customer should know.</p>
      </div>

      {!editable && !saved ? (
        <p className={styles.notice}>
          {ctx.status === "returned"
            ? "This rental is completed. No condition was recorded."
            : "The item condition can be recorded after the item has been picked up."}
        </p>
      ) : null}

      {editable || saved ? (
        <>
          <fieldset className={styles.field} disabled={!editable || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Condition</legend>
            <label>
              <input type="radio" name="item-condition" checked={condition === "good"} onChange={() => setCondition("good")} /> Good Condition
            </label>
            <label>
              <input type="radio" name="item-condition" checked={condition === "damaged"} onChange={() => setCondition("damaged")} /> Has Damage
            </label>
          </fieldset>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Admin notes{condition === "damaged" ? " (required)" : " (optional)"}</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} disabled={!editable || busy} placeholder="Describe what you found" />
          </label>

          <div className={styles.field}>
            <span>Photos (optional, up to {MAX_CONDITION_PHOTOS})</span>
            {photoPaths.length ? (
              <div className={styles.photoGrid}>
                {photoPaths.map((path) => (
                  <div key={path} className={styles.photoThumb}>
                    {photoUrls[path] ? (
                      // Private signed URL; next/image cannot optimize it.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrls[path]} alt="Item condition photo" />
                    ) : (
                      <p className={styles.emptyText}>Loading photo...</p>
                    )}
                    {editable ? (
                      <button type="button" onClick={() => setPhotoPaths((current) => current.filter((item) => item !== path))} disabled={busy}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>No photos added.</p>
            )}
            {editable ? (
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy || uploading || photoPaths.length >= MAX_CONDITION_PHOTOS}
                onChange={(event) => void handleFiles(event.target.files)}
              />
            ) : null}
          </div>

          {editable ? (
            <div className={styles.actions}>
              <Button variant="primary" type="button" onClick={() => void save()} loading={busy || uploading} loadingText={uploading ? "Uploading..." : "Saving..."}>
                Save condition
              </Button>
            </div>
          ) : null}

          {saved && record?.itemCondition === "damaged" ? (
            <p className={styles.noticeWarning}>
              Damage was recorded. If a fee applies, add it yourself in Charges &amp; Payments.{" "}
              <Button variant="none" type="button" onClick={onOpenCharges}>Open Charges &amp; Payments</Button>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: no new errors. If `react-hooks/set-state-in-effect` flags the photo URL effect, its `setPhotoUrls` call is inside a promise callback, so it should not; if it does, add the same `// eslint-disable-next-line react-hooks/set-state-in-effect` comment that `AdminBookingDetail.tsx` uses on its data-loading effect.

- [ ] **Step 5: Commit**

```bash
git add components/admin/fulfillment/PickupPanel.tsx components/admin/fulfillment/ReturnPanel.tsx components/admin/fulfillment/ItemConditionPanel.tsx
git commit -m "feat: add pickup, return and item condition panels"
```

### Task 9: Charges & Payments panel

**Files:**
- Create: `components/admin/fulfillment/ChargesPaymentsPanel.tsx`

**Interfaces:**
- Consumes: Task 1 (`computeAmountOwed`, `activeCharges`, `formatPhp`, `CHARGE_TYPE_LABELS`, `CHARGE_METHOD_LABELS`), Task 6 (`addCharge`, `markChargePaid`, `voidCharge`, date helpers), Task 7 styles.
- Produces: `ChargesPaymentsPanel({ ctx, onNotifyCharge })` default export, where `onNotifyCharge: (chargeId: string) => void` is called by a charge's "Notify customer" button (the shell uses it to open Customer Updates with that charge linked).

- [ ] **Step 1: Create the panel**

Create `components/admin/fulfillment/ChargesPaymentsPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";
import {
  CHARGE_METHOD_LABELS,
  CHARGE_TYPE_LABELS,
  computeAmountOwed,
  formatPhp,
} from "@/src/lib/rentalFulfillment";
import {
  addCharge,
  fromDateTimeLocalValue,
  markChargePaid,
  toDateTimeLocalValue,
  voidCharge,
} from "@/src/services/fulfillmentService";
import type {
  BookingCharge,
  ChargePaymentMethod,
  ChargeType,
  FulfillmentPanelContext,
} from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

interface ChargesPaymentsPanelProps {
  ctx: FulfillmentPanelContext;
  onNotifyCharge: (chargeId: string) => void;
}

const ADD_ALLOWED_STATUSES = ["confirmed", "ready_for_release", "released"];
const CLOSED_STATUSES = ["returned", "cancelled", "rejected"];

export default function ChargesPaymentsPanel({ ctx, onNotifyCharge }: ChargesPaymentsPanelProps) {
  const { showToast } = useToast();
  const { charges, adminNames } = ctx.data;
  const owed = computeAmountOwed({ totalAmount: ctx.totalAmount, verifiedPaid: ctx.verifiedPaid, charges });

  const [chargeType, setChargeType] = useState<ChargeType>("late_fee");
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [payTarget, setPayTarget] = useState<BookingCharge | null>(null);
  const [payMethod, setPayMethod] = useState<ChargePaymentMethod>("cash");
  const [paidAtValue, setPaidAtValue] = useState("");
  const [voidTarget, setVoidTarget] = useState<BookingCharge | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const canAdd = ADD_ALLOWED_STATUSES.includes(ctx.status);
  const canChange = !CLOSED_STATUSES.includes(ctx.status);
  const nameOf = (id?: string) => (id ? adminNames[id] ?? "an admin" : "an admin");

  async function run(action: () => Promise<void>, success: string, fallback: string) {
    setBusy(true);
    try {
      await action();
      await ctx.onChanged();
      showToast(success, "success");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : fallback, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter an amount greater than zero.", "warning");
      return;
    }
    if (reason.trim().length < 3) {
      showToast("Add a short reason for the charge.", "warning");
      return;
    }
    const ok = await run(
      async () => {
        await addCharge(ctx.bookingId, { chargeType, amount, reason: reason.trim() });
      },
      "Charge added.",
      "The charge could not be added.",
    );
    if (ok) {
      setAmountText("");
      setReason("");
    }
  }

  async function handleMarkPaid() {
    if (!payTarget) return;
    const paidAt = fromDateTimeLocalValue(paidAtValue);
    if (!paidAt) {
      showToast("Enter the date and time the payment was received.", "warning");
      return;
    }
    const target = payTarget;
    const ok = await run(
      () => markChargePaid(ctx.bookingId, target.id, { method: payMethod, paidAt }),
      "Charge marked as paid.",
      "The charge could not be updated.",
    );
    if (ok) setPayTarget(null);
  }

  async function handleVoid() {
    if (!voidTarget) return;
    const target = voidTarget;
    const ok = await run(
      () => voidCharge(ctx.bookingId, target.id, voidReason.trim()),
      "Charge voided.",
      "The charge could not be voided.",
    );
    if (ok) {
      setVoidTarget(null);
      setVoidReason("");
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="charges-heading">
      <div className={styles.panelHeader}>
        <h2 id="charges-heading">Charges &amp; Payments</h2>
        <p>See at a glance whether the customer still owes anything. You type every fee yourself.</p>
      </div>

      <div className={owed.totalOwed > 0 ? styles.owedSummary : `${styles.owedSummary} ${styles.owedSummaryClear}`}>
        {owed.totalOwed > 0 ? (
          <>
            <strong>Customer still owes {formatPhp(owed.totalOwed)}</strong>
            <span>
              {owed.bookingBalance > 0 ? `Booking balance ${formatPhp(owed.bookingBalance)}` : "Booking balance paid"}
              {owed.unpaidCharges > 0 ? ` · Unpaid extra charges ${formatPhp(owed.unpaidCharges)}` : ""}
            </span>
          </>
        ) : (
          <>
            <strong>Nothing owed. Fully paid.</strong>
            <span>The booking and all extra charges are settled.</span>
          </>
        )}
      </div>

      <dl className={styles.facts}>
        <div><dt>Booking total</dt><dd>{formatPhp(ctx.totalAmount)}</dd></div>
        <div><dt>Verified payments</dt><dd>{formatPhp(ctx.verifiedPaid)}</dd></div>
        <div><dt>Remaining balance</dt><dd>{formatPhp(owed.bookingBalance)}</dd></div>
        {ctx.payLaterAllowed ? <div><dt>Pay-later exception</dt><dd>Approved</dd></div> : null}
      </dl>

      {ctx.pendingPaymentReviews > 0 ? (
        <p className={styles.noticeWarning}>
          {ctx.pendingPaymentReviews} payment proof{ctx.pendingPaymentReviews === 1 ? " is" : "s are"} waiting for review in the
          follow-up list above.
        </p>
      ) : null}

      <div className={styles.panelHeader}>
        <h2>Extra charges</h2>
      </div>

      {charges.length === 0 ? (
        <p className={styles.emptyText}>No extra charges have been added.</p>
      ) : (
        <ul className={styles.chargeList}>
          {charges.map((charge) => {
            const voided = Boolean(charge.voidedAt);
            return (
              <li key={charge.id} className={`${styles.chargeCard} ${voided ? styles.chargeVoided : ""}`}>
                <div className={styles.chargeHead}>
                  <span className={styles.chargeTitle}>
                    {CHARGE_TYPE_LABELS[charge.chargeType]} · {formatPhp(charge.amount)}
                  </span>
                  <span className={voided ? styles.pill : charge.paymentStatus === "paid" ? styles.pillDone : styles.pillPending}>
                    {voided ? "Voided" : charge.paymentStatus === "paid" ? "Paid" : "Unpaid"}
                  </span>
                </div>
                <p className={styles.chargeMeta}>Reason: {charge.reason}</p>
                <p className={styles.chargeMeta}>
                  Added by {nameOf(charge.createdBy)} on {formatDateTime(charge.createdAt)}
                </p>
                {charge.paymentStatus === "paid" ? (
                  <p className={styles.chargeMeta}>
                    Paid by {charge.paymentMethod ? CHARGE_METHOD_LABELS[charge.paymentMethod] : "-"} on{" "}
                    {formatDateTime(charge.paidAt)}. Recorded by {nameOf(charge.paidRecordedBy)}.
                  </p>
                ) : null}
                {voided ? (
                  <p className={styles.chargeMeta}>
                    Voided by {nameOf(charge.voidedBy)} on {formatDateTime(charge.voidedAt)}. Reason: {charge.voidReason}
                  </p>
                ) : null}
                {!voided && canChange ? (
                  <div className={styles.actions}>
                    {charge.paymentStatus === "unpaid" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setPayMethod("cash");
                          setPaidAtValue(toDateTimeLocalValue());
                          setPayTarget(charge);
                        }}
                      >
                        Mark as paid
                      </Button>
                    ) : null}
                    <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => onNotifyCharge(charge.id)}>
                      Notify customer
                    </Button>
                    <Button variant="danger" size="sm" type="button" disabled={busy} onClick={() => { setVoidReason(""); setVoidTarget(charge); }}>
                      Void
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.panelHeader}>
        <h2>Add a charge</h2>
        <p>Enter the exact amount. Nothing is filled in for you.</p>
      </div>
      {canAdd ? (
        <>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Charge type</span>
              <select value={chargeType} onChange={(event) => setChargeType(event.target.value as ChargeType)} disabled={busy}>
                {(Object.keys(CHARGE_TYPE_LABELS) as ChargeType[]).map((type) => (
                  <option key={type} value={type}>{CHARGE_TYPE_LABELS[type]}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Amount (PHP)</span>
              <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amountText} onChange={(event) => setAmountText(event.target.value)} disabled={busy} />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Reason / admin note</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={busy} placeholder="For example: returned 3 hours after the agreed time" />
            </label>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" type="button" onClick={() => void handleAdd()} loading={busy} loadingText="Saving...">
              Add charge
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.notice}>Charges can be added once the booking is confirmed and until it is completed.</p>
      )}

      {payTarget ? (
        <ConfirmModal
          title="Mark charge as paid"
          description={`Record that ${formatPhp(payTarget.amount)} for the ${CHARGE_TYPE_LABELS[payTarget.chargeType].toLowerCase()} was received.`}
          confirmLabel="Mark as paid"
          busyLabel="Saving..."
          onCancel={() => setPayTarget(null)}
          onConfirm={() => void handleMarkPaid()}
          busy={busy}
        >
          <label>
            <span>Payment method</span>
            <select value={payMethod} onChange={(event) => setPayMethod(event.target.value as ChargePaymentMethod)} disabled={busy}>
              {(Object.keys(CHARGE_METHOD_LABELS) as ChargePaymentMethod[]).map((method) => (
                <option key={method} value={method}>{CHARGE_METHOD_LABELS[method]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Date and time received</span>
            <input type="datetime-local" value={paidAtValue} onChange={(event) => setPaidAtValue(event.target.value)} disabled={busy} />
          </label>
        </ConfirmModal>
      ) : null}

      {voidTarget ? (
        <ConfirmModal
          title="Void this charge?"
          description={
            voidTarget.paymentStatus === "paid"
              ? "This charge was already marked as paid. Voiding keeps the record but it will no longer count. Handle any refund with the customer yourself."
              : "The charge stays on record but no longer counts toward what the customer owes."
          }
          confirmLabel="Void charge"
          busyLabel="Saving..."
          tone="danger"
          onCancel={() => setVoidTarget(null)}
          onConfirm={() => void handleVoid()}
          confirmDisabled={voidReason.trim().length < 3}
          busy={busy}
        >
          <label>
            <span>Reason for voiding (required)</span>
            <textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} rows={3} maxLength={500} disabled={busy} />
          </label>
        </ConfirmModal>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/fulfillment/ChargesPaymentsPanel.tsx
git commit -m "feat: add charges and payments panel"
```

### Task 10: Customer Updates panel

**Files:**
- Create: `components/admin/fulfillment/CustomerUpdatesPanel.tsx`

**Interfaces:**
- Consumes: Task 2 `buildCustomerUpdateEmail`, `formatPeso`; Task 1 helpers; Task 6 `sendCustomerUpdate`, `resendCustomerUpdate`; `bookingTrackingPath` from `@/src/lib/bookingAccess`.
- Produces: `CustomerUpdatesPanel({ ctx, initialChargeId })` default export. `initialChargeId?: string` pre-links a charge; the shell remounts the panel with `key` when it changes, so it is read once as initial state.

- [ ] **Step 1: Create the panel**

Create `components/admin/fulfillment/CustomerUpdatesPanel.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { buildCustomerUpdateEmail } from "@/src/lib/customerUpdateEmailContent";
import { formatPeso } from "@/src/lib/emailShell";
import {
  activeCharges,
  CHARGE_TYPE_LABELS,
  computeAmountOwed,
} from "@/src/lib/rentalFulfillment";
import { resendCustomerUpdate, sendCustomerUpdate } from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext } from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

interface CustomerUpdatesPanelProps {
  ctx: FulfillmentPanelContext;
  initialChargeId?: string;
}

export default function CustomerUpdatesPanel({ ctx, initialChargeId }: CustomerUpdatesPanelProps) {
  const { showToast } = useToast();
  const { updates, charges, adminNames } = ctx.data;
  const owed = computeAmountOwed({ totalAmount: ctx.totalAmount, verifiedPaid: ctx.verifiedPaid, charges });

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [relatedChargeId, setRelatedChargeId] = useState(initialChargeId ?? "");
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const linkable = activeCharges(charges);
  const relatedCharge = linkable.find((charge) => charge.id === relatedChargeId);
  const currentKey = `${subject}\u0000${message}\u0000${relatedChargeId}`;
  const previewing = previewedKey === currentKey && subject.trim() !== "" && message.trim() !== "";
  const hasEmail = ctx.customerEmail.trim() !== "" && ctx.customerEmail !== "-";

  const preview = useMemo(() => {
    if (!previewing) return null;
    return buildCustomerUpdateEmail({
      bookingReference: ctx.bookingRef,
      customerName: ctx.customerName,
      subject: subject.trim(),
      message: message.trim(),
      bookingUrl: `${window.location.origin}${bookingTrackingPath(ctx.bookingId, ctx.isGuest)}`,
      isGuest: ctx.isGuest,
      charge: relatedCharge
        ? {
            label: CHARGE_TYPE_LABELS[relatedCharge.chargeType],
            amount: relatedCharge.amount,
            paid: relatedCharge.paymentStatus === "paid",
          }
        : undefined,
    });
  }, [previewing, ctx.bookingRef, ctx.customerName, ctx.bookingId, ctx.isGuest, subject, message, relatedCharge]);

  function applyTemplate(template: "damage" | "late" | "balance") {
    if (template === "damage") {
      setSubject("Damage found during inspection");
      setMessage("We noticed damage on the item during inspection. Please review the details below.");
    } else if (template === "late") {
      setSubject("Your pickup is late");
      setMessage("Your pickup is late. Please prepare the applicable late fee upon pickup.");
    } else {
      setSubject("Your remaining balance");
      setMessage(`Your remaining balance is ${formatPeso(owed.totalOwed)}.`);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const result = await sendCustomerUpdate(ctx.bookingId, {
        subject: subject.trim(),
        message: message.trim(),
        adminNote: adminNote.trim() || undefined,
        relatedChargeId: relatedChargeId || undefined,
      });
      setSubject("");
      setMessage("");
      setAdminNote("");
      setRelatedChargeId("");
      setPreviewedKey(null);
      await ctx.onChanged();
      showToast(
        result.delivered
          ? `Message sent to ${ctx.customerEmail}.`
          : "The message was saved but could not be emailed. Use Resend in the history below.",
        result.delivered ? "success" : "warning",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The message could not be sent.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function resend(updateId: string) {
    setResendingId(updateId);
    try {
      const result = await resendCustomerUpdate(ctx.bookingId, updateId);
      await ctx.onChanged();
      showToast(
        result.delivered ? "Message sent." : "The message still could not be emailed. Please try again later.",
        result.delivered ? "success" : "warning",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The message could not be sent.", "error");
    } finally {
      setResendingId(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="updates-heading">
      <div className={styles.panelHeader}>
        <h2 id="updates-heading">Customer Updates</h2>
        <p>
          Write a message and email it to {hasEmail ? ctx.customerEmail : "the customer"}. Preview it first. Every message is
          kept in the history below.
        </p>
      </div>

      {!hasEmail ? <p className={styles.noticeWarning}>This booking has no customer email address, so messages cannot be sent.</p> : null}

      <div className={styles.actions} aria-label="Message starters">
        <Button variant="secondary" size="sm" type="button" onClick={() => applyTemplate("damage")} disabled={busy}>Damage notice</Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => applyTemplate("late")} disabled={busy}>Late pickup</Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => applyTemplate("balance")} disabled={busy}>Remaining balance</Button>
      </div>

      <div className={styles.fieldGrid}>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Subject</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={150} disabled={busy} placeholder="What is this about?" />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Message to the customer</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} disabled={busy} placeholder="Write in simple, friendly words" />
        </label>
        <label className={styles.field}>
          <span>Related charge (optional)</span>
          <select value={relatedChargeId} onChange={(event) => setRelatedChargeId(event.target.value)} disabled={busy}>
            <option value="">None</option>
            {linkable.map((charge) => (
              <option key={charge.id} value={charge.id}>
                {CHARGE_TYPE_LABELS[charge.chargeType]} · {formatPeso(charge.amount)} ({charge.paymentStatus === "paid" ? "Paid" : "Unpaid"})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Admin note (kept in history, not emailed)</span>
          <input value={adminNote} onChange={(event) => setAdminNote(event.target.value)} maxLength={1000} disabled={busy} />
        </label>
      </div>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          type="button"
          onClick={() => setPreviewedKey(currentKey)}
          disabled={busy || subject.trim() === "" || message.trim() === ""}
        >
          Preview message
        </Button>
        <Button variant="primary" type="button" onClick={() => void send()} disabled={!previewing || !hasEmail} loading={busy} loadingText="Sending...">
          Send to customer
        </Button>
        {!previewing ? <span className={styles.emptyText}>Preview the message before sending.</span> : null}
      </div>

      {preview ? (
        <div>
          <p className={styles.emptyText}>To: {ctx.customerEmail} · Subject: {preview.subject}</p>
          <iframe className={styles.previewFrame} title="Email preview" sandbox="" srcDoc={preview.html} />
        </div>
      ) : null}

      <div className={styles.panelHeader}>
        <h2>Message history</h2>
      </div>
      {updates.length === 0 ? (
        <p className={styles.emptyText}>No messages have been sent yet.</p>
      ) : (
        <ul className={styles.history}>
          {updates.map((update) => {
            const linked = charges.find((charge) => charge.id === update.relatedChargeId);
            return (
              <li key={update.id} className={styles.historyItem}>
                <div className={styles.chargeHead}>
                  <span className={styles.chargeTitle}>{update.subject}</span>
                  <span className={update.deliveryStatus === "sent" ? styles.pillDone : styles.pillPending}>
                    {update.deliveryStatus === "sent" ? "Sent" : "Not sent"}
                  </span>
                </div>
                <p className={styles.chargeMeta}>
                  {update.deliveryStatus === "sent"
                    ? `Sent ${formatDateTime(update.sentAt)} to ${update.sentTo ?? "the customer"}`
                    : `Saved ${formatDateTime(update.createdAt)}. ${update.deliveryAttempts} attempt${update.deliveryAttempts === 1 ? "" : "s"} so far.`}
                  {update.sentBy ? ` By ${adminNames[update.sentBy] ?? "an admin"}.` : ""}
                </p>
                <p>{update.message}</p>
                {linked ? (
                  <p className={styles.chargeMeta}>
                    Related charge: {CHARGE_TYPE_LABELS[linked.chargeType]} · {formatPeso(linked.amount)}
                  </p>
                ) : null}
                {update.adminNote ? <p className={styles.chargeMeta}>Admin note: {update.adminNote}</p> : null}
                {update.deliveryStatus === "failed" ? (
                  <div className={styles.actions}>
                    <Button variant="secondary" size="sm" type="button" onClick={() => void resend(update.id)} loading={resendingId === update.id} loadingText="Sending..." disabled={resendingId !== null || !hasEmail}>
                      Resend
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: no new errors. If the linter objects to reading `window` inside `useMemo`, this component is client-only and only computes the value after the admin clicks Preview, so add the guard `typeof window === "undefined" ? "" : window.location.origin`.

- [ ] **Step 3: Commit**

```bash
git add components/admin/fulfillment/CustomerUpdatesPanel.tsx
git commit -m "feat: add customer updates panel"
```

### Task 11: Complete Rental panel

**Files:**
- Modify: `src/types/fulfillment.ts` (add `returnedAt` to the panel context)
- Create: `components/admin/fulfillment/CompleteRentalPanel.tsx`

**Interfaces:**
- Consumes: Task 1 (`getCompletionBlockers`, `computeAmountOwed`), Task 6 (`completeRental`, `resendCompletionEmail`, `FulfillmentApiError`).
- Produces: `CompleteRentalPanel({ ctx })` default export. `FulfillmentPanelContext` gains `returnedAt?: string` (the booking's completion timestamp).

- [ ] **Step 1: Add `returnedAt` to the panel context**

In `src/types/fulfillment.ts`, inside `FulfillmentPanelContext`, add after `releasedAt?: string;`:

```ts
  /** When the rental was marked Completed (the booking's returned_at). */
  returnedAt?: string;
```

- [ ] **Step 2: Create the panel**

Create `components/admin/fulfillment/CompleteRentalPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";
import { computeAmountOwed, getCompletionBlockers } from "@/src/lib/rentalFulfillment";
import {
  completeRental,
  FulfillmentApiError,
  resendCompletionEmail,
} from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext } from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

export default function CompleteRentalPanel({ ctx }: { ctx: FulfillmentPanelContext }) {
  const { showToast } = useToast();
  const { record, charges, email } = ctx.data;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);

  const completed = ctx.status === "returned";
  const owed = computeAmountOwed({ totalAmount: ctx.totalAmount, verifiedPaid: ctx.verifiedPaid, charges });
  const blockers = getCompletionBlockers({
    status: ctx.status,
    returned: record?.returned === true,
    itemCondition: record?.itemCondition ?? null,
    charges,
    totalAmount: ctx.totalAmount,
    verifiedPaid: ctx.verifiedPaid,
    pendingPaymentReviews: ctx.pendingPaymentReviews,
  });

  const checks = [
    { label: "Item returned", done: record?.returned === true },
    { label: "Item condition checked", done: record?.itemCondition != null },
    { label: "Balance and extra charges settled or resolved", done: owed.totalOwed === 0 },
    { label: "No unresolved required admin action", done: ctx.pendingPaymentReviews === 0 && ctx.status === "released" },
  ];

  async function complete() {
    setBusy(true);
    try {
      const result = await completeRental(ctx.bookingId, note.trim());
      setConfirmOpen(false);
      setNote("");
      await ctx.onChanged();
      showToast(
        result.emailSent
          ? "Rental completed. The Rental Completed email was sent to the customer."
          : "Rental completed, but the email could not be sent. Use Resend Email.",
        result.emailSent ? "success" : "warning",
      );
    } catch (error) {
      setConfirmOpen(false);
      const detail = error instanceof FulfillmentApiError && error.blockers.length ? ` ${error.blockers.join(" ")}` : "";
      showToast(`${error instanceof Error ? error.message : "The rental could not be completed."}${detail}`, "error");
      await ctx.onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    try {
      const result = await resendCompletionEmail(ctx.bookingId);
      await ctx.onChanged();
      showToast(`Completion email sent to ${result.emailedTo}.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The completion email could not be sent.", "error");
    } finally {
      setResending(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="complete-heading">
      <div className={styles.panelHeader}>
        <h2 id="complete-heading">Complete Rental</h2>
        <p>
          Finish the rental once the item is back, checked, and everything is paid. The booking becomes Completed, loyalty
          follows the existing rules automatically, and the customer receives a Rental Completed email.
        </p>
      </div>

      {completed ? (
        <>
          <p className={styles.noticeSuccess}>This rental is Completed.</p>
          <dl className={styles.facts}>
            <div><dt>Completed on</dt><dd>{formatDateTime(ctx.returnedAt)}</dd></div>
            <div>
              <dt>Completion email</dt>
              <dd>
                {email.completionEmailSentAt
                  ? `Sent ${formatDateTime(email.completionEmailSentAt)}${email.completionEmailTo ? ` to ${email.completionEmailTo}` : ""}`
                  : "Not sent yet"}
              </dd>
            </div>
          </dl>
          {!email.completionEmailSentAt ? (
            <>
              <p className={styles.noticeWarning}>The rental is Completed, but the customer has not received the email yet.</p>
              <div className={styles.actions}>
                <Button variant="primary" type="button" onClick={() => void resend()} loading={resending} loadingText="Sending email...">
                  Resend Email
                </Button>
              </div>
            </>
          ) : (
            <div className={styles.actions}>
              <Button variant="secondary" type="button" onClick={() => void resend()} loading={resending} loadingText="Sending email...">
                Resend Email
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <ul className={styles.checklist}>
            {checks.map((check) => (
              <li key={check.label} className={`${styles.checkItem} ${check.done ? styles.checkDone : styles.checkBlocked}`}>
                <span aria-hidden="true">{check.done ? "✓" : "•"}</span>
                <span>{check.label}</span>
              </li>
            ))}
          </ul>

          {blockers.length > 0 ? (
            <div className={styles.noticeWarning}>
              <strong>Still to do:</strong>
              <ul>
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={styles.actions}>
            <Button variant="primary" type="button" onClick={() => setConfirmOpen(true)} disabled={blockers.length > 0 || busy}>
              Complete Rental
            </Button>
          </div>
        </>
      )}

      {confirmOpen ? (
        <ConfirmModal
          title="Complete this rental?"
          description={`Booking ${ctx.bookingRef} will be marked Completed and the customer will be emailed a summary. This cannot be undone.`}
          confirmLabel="Yes, Complete Rental"
          busyLabel="Completing..."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void complete()}
          busy={busy}
        >
          <label>
            <span>Note for the booking history (optional)</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} disabled={busy} />
          </label>
        </ConfirmModal>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/fulfillment.ts components/admin/fulfillment/CompleteRentalPanel.tsx
git commit -m "feat: add complete rental panel"
```

### Task 12: Follow-up strip, booking record and fulfillment shell

**Files:**
- Create: `components/admin/fulfillment/FollowUpStrip.tsx`
- Create: `components/admin/fulfillment/BookingRecord.tsx`
- Create: `components/admin/fulfillment/RentalFulfillment.tsx`

**Interfaces:**
- Consumes: Tasks 1, 7, 8, 9, 10, 11 (all panels, `FollowUpItem`, `FollowUpKind`, `EmailHistoryEntry`).
- Produces:
  - `FollowUpStrip({ items, actions })` default export; renders nothing when `items` is empty
  - `BookingRecord(props: BookingRecordProps)` default export (read-only; no action controls except opening files and the agreement PDF)
  - `RentalFulfillment(props: RentalFulfillmentProps)` default export
  - `BookingRecordProps = { booking: Booking; customerName: string; email: string; phone: string; address: string; documents: BookingDocument[]; payments: PaymentRecord[]; receipts: BookingReceipt[]; agreement: AgreementDoc | null; statusHistory: StatusHistoryEntry[]; emailHistory: EmailHistoryEntry[]; onOpenFile: (bucket: string, path: string) => void }`
  - `RentalFulfillmentProps = { ctx: FulfillmentPanelContext; followUpItems: FollowUpItem[]; followUpActions: Partial<Record<FollowUpKind, ReactNode>>; record: BookingRecordProps; onRequestCancel?: () => void; onResendApprovalEmail: () => void; resendingApprovalEmail: boolean }`

- [ ] **Step 1: Create the follow-up strip**

Create `components/admin/fulfillment/FollowUpStrip.tsx`:

```tsx
import type { ReactNode } from "react";
import type { FollowUpItem, FollowUpKind } from "@/src/lib/rentalFulfillment";
import styles from "./fulfillment.module.css";

interface FollowUpStripProps {
  items: FollowUpItem[];
  /** Existing controls to show under each item (payment review, countersign, status action...). */
  actions: Partial<Record<FollowUpKind, ReactNode>>;
}

/**
 * Lists only unfinished items. With nothing left to do it renders nothing at all, so the strip
 * disappears completely instead of showing an "all done" message.
 */
export default function FollowUpStrip({ items, actions }: FollowUpStripProps) {
  if (items.length === 0) return null;

  return (
    <section className={styles.strip} aria-labelledby="followup-heading">
      <h2 id="followup-heading">Still to finish</h2>
      {items.map((item) => (
        <div key={item.kind} className={styles.stripItem}>
          <strong>{item.title}</strong>
          <p>{item.detail}</p>
          {actions[item.kind] ? <div className={styles.stripBody}>{actions[item.kind]}</div> : null}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Create the read-only booking record**

Create `components/admin/fulfillment/BookingRecord.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/Button";
import type { EmailHistoryEntry } from "@/src/lib/rentalFulfillment";
import type {
  AgreementDoc,
  Booking,
  BookingDocument,
  StatusHistoryEntry,
} from "@/src/types/booking";
import type { BookingReceipt, PaymentRecord } from "@/src/types/payment";
import { formatDateTime, formatDay } from "./format";
import styles from "./fulfillment.module.css";

export interface BookingRecordProps {
  booking: Booking;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  documents: BookingDocument[];
  payments: PaymentRecord[];
  receipts: BookingReceipt[];
  agreement: AgreementDoc | null;
  statusHistory: StatusHistoryEntry[];
  emailHistory: EmailHistoryEntry[];
  onOpenFile: (bucket: string, path: string) => void;
}

function label(value: string | null | undefined): string {
  if (!value) return "-";
  if (value === "returned") return "Completed";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Permanent read-only history of the booking: everything from the original review, approval,
 * payments, documents and agreement stays available here after the review tabs are hidden.
 */
export default function BookingRecord({
  booking,
  customerName,
  email,
  phone,
  address,
  documents,
  payments,
  receipts,
  agreement,
  statusHistory,
  emailHistory,
  onOpenFile,
}: BookingRecordProps) {
  const customerSignature = agreement?.signatures?.find((item) => item.signerRole === "customer");
  const businessSignature = agreement?.signatures?.find((item) => item.signerRole === "business");

  return (
    <section className={styles.recordSection} aria-label="Booking record">
      <div className={styles.recordGrid}>
        <article className={styles.recordCard}>
          <h3>Customer and rental</h3>
          <dl className={styles.facts}>
            <div><dt>Customer</dt><dd>{customerName}</dd></div>
            <div><dt>Email</dt><dd>{email}</dd></div>
            <div><dt>Phone</dt><dd>{phone}</dd></div>
            <div><dt>Address</dt><dd>{address}</dd></div>
            <div><dt>Rental dates</dt><dd>{formatDay(booking.startDate)} to {formatDay(booking.endDate)}</dd></div>
            <div><dt>Fulfillment</dt><dd>{label(booking.fulfillmentMethod)}</dd></div>
            <div><dt>Status</dt><dd>{label(booking.status)}</dd></div>
            <div><dt>Booking total</dt><dd>PHP {booking.totalAmount.toLocaleString("en-PH")}</dd></div>
          </dl>
          <ul className={styles.history}>
            {booking.items.map((item) => (
              <li key={item.bookingItemId} className={styles.historyItem}>
                <span className={styles.chargeTitle}>{item.productName} × {item.quantity}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className={styles.recordCard}>
          <h3>Payments and receipts</h3>
          {payments.length === 0 ? <p className={styles.emptyText}>No payments were submitted.</p> : (
            <ul className={styles.history}>
              {payments.map((payment) => (
                <li key={payment.id} className={styles.historyItem}>
                  <span className={styles.chargeTitle}>{label(payment.stage)} · PHP {payment.amount.toLocaleString("en-PH")}</span>
                  <p className={styles.chargeMeta}>
                    {label(payment.status)} · Submitted {formatDateTime(payment.submittedAt)}
                    {payment.reviewerName ? ` · Reviewed by ${payment.reviewerName}` : ""}
                  </p>
                  {payment.proofStorageBucket && payment.proofStoragePath ? (
                    <div className={styles.actions}>
                      <Button variant="secondary" size="sm" type="button" onClick={() => onOpenFile(payment.proofStorageBucket!, payment.proofStoragePath!)}>
                        Open proof
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {receipts.filter((receipt) => receipt.documentPath).map((receipt) => (
            <div key={receipt.id} className={styles.actions}>
              <Button variant="secondary" size="sm" type="button" onClick={() => onOpenFile("receipts", receipt.documentPath!)}>
                Open receipt {receipt.receiptNumber}
              </Button>
            </div>
          ))}
        </article>

        <article className={styles.recordCard}>
          <h3>Verification documents</h3>
          {documents.length === 0 ? <p className={styles.emptyText}>No documents were submitted.</p> : (
            <ul className={styles.history}>
              {documents.map((document) => (
                <li key={document.id} className={styles.historyItem}>
                  <span className={styles.chargeTitle}>{label(document.documentType)}</span>
                  <p className={styles.chargeMeta}>{label(document.reviewStatus)}</p>
                  {document.storageBucket && document.storagePath ? (
                    <div className={styles.actions}>
                      <Button variant="secondary" size="sm" type="button" onClick={() => onOpenFile(document.storageBucket, document.storagePath)}>
                        Open document
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className={styles.recordCard}>
          <h3>Rental agreement</h3>
          {agreement ? (
            <>
              <dl className={styles.facts}>
                <div><dt>Status</dt><dd>{label(agreement.status)}</dd></div>
                <div>
                  <dt>Customer signature</dt>
                  <dd>{customerSignature ? `${customerSignature.signerName}, ${formatDateTime(customerSignature.signedAt)}` : "Not signed"}</dd>
                </div>
                <div>
                  <dt>Business countersignature</dt>
                  <dd>{businessSignature ? `${businessSignature.signerName}, ${formatDateTime(businessSignature.signedAt)}` : "Not signed"}</dd>
                </div>
              </dl>
              {agreement.finalDocumentPath ? (
                <div className={styles.actions}>
                  <Button variant="secondary" size="sm" type="button" onClick={() => onOpenFile("agreements", agreement.finalDocumentPath!)}>
                    Open final agreement PDF
                  </Button>
                </div>
              ) : null}
            </>
          ) : <p className={styles.emptyText}>No rental agreement was created.</p>}
        </article>

        <article className={styles.recordCard}>
          <h3>Email history</h3>
          {emailHistory.length === 0 ? <p className={styles.emptyText}>No emails are recorded.</p> : (
            <ul className={styles.history}>
              {emailHistory.map((entry) => (
                <li key={entry.key} className={styles.historyItem}>
                  <span className={styles.chargeTitle}>{entry.label}</span>
                  <p className={styles.chargeMeta}>
                    {entry.result}{entry.at ? ` · ${formatDateTime(entry.at)}` : ""}{entry.detail ? ` · ${entry.detail}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className={styles.recordCard}>
          <h3>Status history</h3>
          {statusHistory.length === 0 ? <p className={styles.emptyText}>No status history is available.</p> : (
            <ul className={styles.history}>
              {statusHistory.map((entry) => (
                <li key={entry.id} className={styles.historyItem}>
                  <span className={styles.chargeTitle}>
                    {entry.fromStatus ? `${label(entry.fromStatus)} to ` : ""}{label(entry.toStatus)}
                  </span>
                  <p className={styles.chargeMeta}>{entry.note || "Status updated."} · {formatDateTime(entry.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create the shell**

Create `components/admin/fulfillment/RentalFulfillment.tsx`:

```tsx
"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { computeAmountOwed, type FollowUpItem, type FollowUpKind } from "@/src/lib/rentalFulfillment";
import type { FulfillmentPanelContext } from "@/src/types/fulfillment";
import BookingRecord, { type BookingRecordProps } from "./BookingRecord";
import ChargesPaymentsPanel from "./ChargesPaymentsPanel";
import CompleteRentalPanel from "./CompleteRentalPanel";
import CustomerUpdatesPanel from "./CustomerUpdatesPanel";
import FollowUpStrip from "./FollowUpStrip";
import ItemConditionPanel from "./ItemConditionPanel";
import PickupPanel from "./PickupPanel";
import ReturnPanel from "./ReturnPanel";
import styles from "./fulfillment.module.css";

type TabId = "pickup" | "return" | "condition" | "charges" | "updates" | "complete";

const TABS: { id: TabId; label: string }[] = [
  { id: "pickup", label: "Pickup" },
  { id: "return", label: "Return" },
  { id: "condition", label: "Item Condition" },
  { id: "charges", label: "Charges & Payments" },
  { id: "updates", label: "Customer Updates" },
  { id: "complete", label: "Complete Rental" },
];

export interface RentalFulfillmentProps {
  ctx: FulfillmentPanelContext;
  followUpItems: FollowUpItem[];
  followUpActions: Partial<Record<FollowUpKind, ReactNode>>;
  record: BookingRecordProps;
  onRequestCancel?: () => void;
  onResendApprovalEmail: () => void;
  resendingApprovalEmail: boolean;
}

function firstOpenTab(ctx: FulfillmentPanelContext): TabId {
  const record = ctx.data.record;
  if (ctx.status === "returned") return "complete";
  if (!record?.pickedUp) return "pickup";
  if (!record.returned) return "return";
  if (!record.itemCondition) return "condition";
  const owed = computeAmountOwed({ totalAmount: ctx.totalAmount, verifiedPaid: ctx.verifiedPaid, charges: ctx.data.charges });
  return owed.totalOwed > 0 ? "charges" : "complete";
}

export default function RentalFulfillment({
  ctx,
  followUpItems,
  followUpActions,
  record,
  onRequestCancel,
  onResendApprovalEmail,
  resendingApprovalEmail,
}: RentalFulfillmentProps) {
  const [activeTab, setActiveTab] = useState<TabId>(() => firstOpenTab(ctx));
  const [recordOpen, setRecordOpen] = useState(false);
  const [notifyChargeId, setNotifyChargeId] = useState<string | undefined>(undefined);

  const data = ctx.data;
  const owed = computeAmountOwed({ totalAmount: ctx.totalAmount, verifiedPaid: ctx.verifiedPaid, charges: data.charges });
  const tabState: Partial<Record<TabId, boolean>> = {
    pickup: data.record?.pickedUp === true,
    return: data.record?.returned === true,
    condition: data.record?.itemCondition != null,
    charges: owed.totalOwed === 0,
    complete: ctx.status === "returned",
  };

  function openCharges() {
    setActiveTab("charges");
  }

  function notifyAboutCharge(chargeId: string) {
    setNotifyChargeId(chargeId);
    setActiveTab("updates");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + step + TABS.length) % TABS.length;
    setActiveTab(TABS[next].id);
    window.setTimeout(() => document.getElementById(`fulfillment-tab-${TABS[next].id}`)?.focus(), 0);
  }

  return (
    <>
      {data.email.approvalEmailStatus === "legacy" ? (
        <div className={styles.banner} role="status">
          <span>Confirmation email status unavailable</span>
          <Button variant="secondary" size="sm" type="button" onClick={onResendApprovalEmail} loading={resendingApprovalEmail} loadingText="Sending email...">
            Resend Email
          </Button>
        </div>
      ) : null}

      <FollowUpStrip items={followUpItems} actions={followUpActions} />

      <nav className={styles.tabs} role="tablist" aria-label="Rental fulfillment steps">
        {TABS.map((tab, index) => {
          const done = tabState[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`fulfillment-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`fulfillment-panel-${tab.id}`}
              className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span>{tab.label}</span>
              {done === undefined ? null : (
                <span className={`${styles.tabState} ${done ? styles.tabStateDone : ""}`}>{done ? "Done" : "To do"}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div id="fulfillment-panel-pickup" role="tabpanel" aria-labelledby="fulfillment-tab-pickup" hidden={activeTab !== "pickup"}>
        <PickupPanel ctx={ctx} onOpenCharges={openCharges} onRequestCancel={onRequestCancel} />
      </div>
      <div id="fulfillment-panel-return" role="tabpanel" aria-labelledby="fulfillment-tab-return" hidden={activeTab !== "return"}>
        <ReturnPanel ctx={ctx} />
      </div>
      <div id="fulfillment-panel-condition" role="tabpanel" aria-labelledby="fulfillment-tab-condition" hidden={activeTab !== "condition"}>
        <ItemConditionPanel ctx={ctx} onOpenCharges={openCharges} />
      </div>
      <div id="fulfillment-panel-charges" role="tabpanel" aria-labelledby="fulfillment-tab-charges" hidden={activeTab !== "charges"}>
        <ChargesPaymentsPanel ctx={ctx} onNotifyCharge={notifyAboutCharge} />
      </div>
      <div id="fulfillment-panel-updates" role="tabpanel" aria-labelledby="fulfillment-tab-updates" hidden={activeTab !== "updates"}>
        <CustomerUpdatesPanel key={notifyChargeId ?? "none"} ctx={ctx} initialChargeId={notifyChargeId} />
      </div>
      <div id="fulfillment-panel-complete" role="tabpanel" aria-labelledby="fulfillment-tab-complete" hidden={activeTab !== "complete"}>
        <CompleteRentalPanel ctx={ctx} />
      </div>

      <Button variant="secondary" type="button" className={styles.recordToggle} aria-expanded={recordOpen} onClick={() => setRecordOpen((open) => !open)}>
        {recordOpen ? "Hide Booking Record" : "View Booking Record"}
      </Button>
      {recordOpen ? <BookingRecord {...record} /> : null}
    </>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: PASS. If `document.storageBucket` or `document.id` types differ, use the field names from `BookingDocument` in `src/types/booking.ts`. Likewise `agreement.status` and `signature.signedAt` come from `AgreementDoc` and `AgreementSignature` in the same file.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add components/admin/fulfillment/FollowUpStrip.tsx components/admin/fulfillment/BookingRecord.tsx components/admin/fulfillment/RentalFulfillment.tsx
git commit -m "feat: add rental fulfillment shell, follow-up strip and booking record"
```

### Task 13: Integrate into the booking review page

**Files:**
- Modify: `app/admin/bookings/[bookingId]/AdminBookingDetail.tsx`
- Modify: `components/status-badge/StatusBadge.tsx`

**Interfaces:**
- Consumes: everything above. Existing pieces reused unchanged: `renderActionChoice`, `PaymentsReviewPanel`, `RequirementsReviewPanel`, `handleDocumentReviewed`, `openPrivateFile`, `requestCountersignAgreement`, the countersign state, the status `ConfirmModal`, the approval-email popup and the countersign `ConfirmModal`.
- Produces: the page switches to `RentalFulfillment` when `isFulfillmentMode` is true. The old review UI is unchanged otherwise.

All edits below are exact-string replacements. Do each one in order.

- [ ] **Step 1: Import the new pieces**

Replace:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
```

Replace:

```tsx
import { bookingHeadline, bookingItemsSummaryData } from "@/src/lib/bookingDisplay";
```

with:

```tsx
import { bookingHeadline, bookingItemsSummaryData } from "@/src/lib/bookingDisplay";
import type { BookingRecordProps } from "@/components/admin/fulfillment/BookingRecord";
import RentalFulfillment from "@/components/admin/fulfillment/RentalFulfillment";
import {
  buildEmailHistory,
  getFollowUpItems,
  isFulfillmentMode,
  PAYMENT_AWAITING_REVIEW_STATUSES,
  type FollowUpKind,
} from "@/src/lib/rentalFulfillment";
import { getFulfillmentData } from "@/src/services/fulfillmentService";
import type { FulfillmentData, FulfillmentPanelContext } from "@/src/types/fulfillment";
```

- [ ] **Step 2: Add fulfillment data to the page state**

Replace:

```tsx
  receipts: BookingReceipt[];
}

type AdminReviewStep =
```

with:

```tsx
  receipts: BookingReceipt[];
  fulfillment: FulfillmentData;
}

type AdminReviewStep =
```

Replace:

```tsx
      const [profile, payments, receipts] = await Promise.all([
        getUserProfile(details.booking.customerId),
        getBookingPayments(supabase, bookingId),
        getBookingReceipts(supabase, bookingId),
      ]);
      setState({ details, profile, payments, receipts });
```

with:

```tsx
      const [profile, payments, receipts, fulfillment] = await Promise.all([
        getUserProfile(details.booking.customerId),
        getBookingPayments(supabase, bookingId),
        getBookingReceipts(supabase, bookingId),
        getFulfillmentData(supabase, bookingId),
      ]);
      setState({ details, profile, payments, receipts, fulfillment });
```

- [ ] **Step 3: Reload after a successful confirmation email resend**

In `handleSendBookingConfirmationEmail`, replace:

```tsx
      setConfirmationEmailSentAt(new Date().toISOString());
      setApprovalEmailFailed(false);
      setApprovalEmailPopupOpen(false);
```

with:

```tsx
      setConfirmationEmailSentAt(new Date().toISOString());
      setApprovalEmailFailed(false);
      setApprovalEmailPopupOpen(false);
      // A successful resend saves the email as sent, which opens Rental Fulfillment.
      await loadDetails();
```

- [ ] **Step 4: Compute the gate, follow-up items and panel context**

Replace this line (after the `reviewChecks` block):

```tsx
  const bookingApproved = ["approved", "confirmed", "ready_for_release", "released"].includes(booking.status);
```

with:

```tsx
  const bookingApproved = ["approved", "confirmed", "ready_for_release", "released"].includes(booking.status);
  const fulfillment = state.fulfillment;
  const fulfillmentMode =
    fulfillment.available &&
    isFulfillmentMode({ status: booking.status, approvalEmailStatus: fulfillment.email.approvalEmailStatus });
  const pendingPaymentReviews = payments.filter((payment) =>
    (PAYMENT_AWAITING_REVIEW_STATUSES as readonly string[]).includes(payment.status),
  ).length;
  const followUpItems = getFollowUpItems({
    status: booking.status,
    pendingPaymentReviews,
    requirementsApproved: booking.requirementsStatus === "approved",
    agreementStatus: booking.agreementStatus,
    canCountersign: canCountersignAgreement,
  });
  const fulfillmentContext: FulfillmentPanelContext = {
    bookingId,
    bookingRef: booking.bookingRef,
    status: booking.status,
    customerName: fullName,
    customerEmail: email,
    isGuest: booking.isGuestCheckout,
    totalAmount: booking.totalAmount,
    verifiedPaid: amountPaid,
    pendingPaymentReviews,
    payLaterAllowed: booking.payLaterAllowed,
    handoverPaymentReady,
    releasedAt: booking.releasedAt,
    returnedAt: booking.returnedAt,
    data: fulfillment,
    onChanged: loadDetails,
  };
```

- [ ] **Step 5: Build the follow-up controls and record props**

Replace:

```tsx
  return (
    <div className={styles.page}>
      <Link href="/admin/bookings" className={styles.backLink}>Back to Bookings</Link>

      <header className={styles.header}>
```

with:

```tsx
  const openFile = (bucket: string, path: string) =>
    void openPrivateFile(bucket as Parameters<typeof getBookingFileUrl>[1], path);
  const statusAction = (status: BookingStatus) => {
    const action = actions.find((candidate) => candidate.status === status);
    return action ? <div className={styles.actionChoiceGrid}>{renderActionChoice(action)}</div> : null;
  };
  const followUpActions: Partial<Record<FollowUpKind, ReactNode>> = {
    payment_review: (
      <PaymentsReviewPanel
        bookingId={bookingId}
        booking={booking}
        payments={payments}
        onOpenProof={(payment: PaymentRecord) => {
          if (payment.proofStorageBucket && payment.proofStoragePath) {
            openFile(payment.proofStorageBucket, payment.proofStoragePath);
          }
        }}
        onUpdated={loadDetails}
      />
    ),
    documents: (
      <RequirementsReviewPanel
        bookingId={bookingId}
        documents={documents}
        onOpenDocument={(document) => openFile(document.storageBucket, document.storagePath)}
        onReviewed={handleDocumentReviewed}
      />
    ),
    countersign: (
      <div className={styles.countersignPanel}>
        <label className={styles.signerField}>
          <input
            value={businessSignerName}
            onChange={(event) => setBusinessSignerName(event.target.value)}
            maxLength={120}
            placeholder="Enter the person signing for Maddy & Cassy"
            disabled={!canCountersignAgreement || countersigning}
          />
        </label>
        <label className={styles.authorizationCheck}>
          <input
            type="checkbox"
            checked={countersignAcknowledged}
            onChange={(event) => setCountersignAcknowledged(event.target.checked)}
            disabled={!canCountersignAgreement || countersigning}
          />
          <span>I confirm that I am authorized to countersign this rental agreement for Rental by Maddy &amp; Cassy.</span>
        </label>
        <Button variant="none"
          type="button"
          className={styles.countersignButton}
          onClick={requestCountersignAgreement}
          disabled={!canCountersignAgreement || !businessSignerName.trim() || !countersignAcknowledged || countersigning}
        >
          {countersigning ? "Finalizing agreement..." : "Countersign & Finalize Agreement"}
        </Button>
      </div>
    ),
    confirm_booking: statusAction("confirmed"),
    ready_for_handover: statusAction("ready_for_release"),
  };
  const recordProps: BookingRecordProps = {
    booking,
    customerName: fullName,
    email,
    phone,
    address,
    documents,
    payments,
    receipts,
    agreement,
    statusHistory,
    emailHistory: buildEmailHistory({ email: fulfillment.email, receipts, updates: fulfillment.updates }),
    onOpenFile: openFile,
  };

  return (
    <div className={styles.page}>
      <Link href="/admin/bookings" className={styles.backLink}>Back to Bookings</Link>

      <header className={styles.header}>
```

- [ ] **Step 6: Change the header label in Fulfillment mode**

Replace:

```tsx
          <p className={styles.eyebrow}>BOOKING REVIEW</p>
```

with:

```tsx
          <p className={styles.eyebrow}>{fulfillmentMode ? "RENTAL FULFILLMENT" : "BOOKING REVIEW"}</p>
```

- [ ] **Step 7: Hide the review summary in Fulfillment mode**

Replace:

```tsx
      <section className={styles.bookingSummarySection} aria-label="Booking summary">
```

with:

```tsx
      {!fulfillmentMode ? (
      <section className={styles.bookingSummarySection} aria-label="Booking summary">
```

Replace:

```tsx
        </article>
      </section>

      {cancellationRequest ? (
```

with:

```tsx
        </article>
      </section>
      ) : null}

      {cancellationRequest ? (
```

The customer cancellation request panel stays visible in both modes on purpose, because a customer can ask to cancel while the booking is approved.

- [ ] **Step 8: Swap the review tabs for Rental Fulfillment**

Replace:

```tsx
      <nav id="admin-workspace-nav" className={styles.stepNav} aria-label="Booking review steps" role="tablist">
```

with:

```tsx
      {fulfillmentMode ? (
        <RentalFulfillment
          ctx={fulfillmentContext}
          followUpItems={followUpItems}
          followUpActions={followUpActions}
          record={recordProps}
          onRequestCancel={() => { setSelectedStatus("cancelled"); setNote(""); setDeclineReason(""); }}
          onResendApprovalEmail={() => void handleSendBookingConfirmationEmail()}
          resendingApprovalEmail={sendingConfirmationEmail}
        />
      ) : (
      <>
      <nav id="admin-workspace-nav" className={styles.stepNav} aria-label="Booking review steps" role="tablist">
```

Replace:

```tsx
      </div>

      {selectedAction ? (
```

with:

```tsx
      </div>
      </>
      )}

      {selectedAction ? (
```

- [ ] **Step 9: Show "Completed" instead of "Returned"**

In `components/status-badge/StatusBadge.tsx`, replace:

```tsx
  returned: "Returned",
```

with:

```tsx
  returned: "Completed",
```

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit`
Expected: PASS. If `booking.releasedAt` or `booking.returnedAt` is a type error, confirm both exist on `Booking` in `src/types/booking.ts` (they are `releasedAt?: string` and `returnedAt?: string`).

Run: `npm run lint`
Expected: no new errors. Fix any "unused variable" warning for values that are now only used inside the non-fulfillment branch; they are still used, so none are expected.

Run: `npm run test:fulfillment && npm run test:bookings`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add app/admin/bookings/[bookingId]/AdminBookingDetail.tsx components/status-badge/StatusBadge.tsx
git commit -m "feat: show rental fulfillment after approval on the booking review page"
```

### Task 14: Verify, apply the migration, and test end to end

**Files:** none (verification only). No code is written in this task unless a check fails.

- [ ] **Step 1: Run the full automated verification**

Run: `npm run verify`
Expected: lint, `tsc --noEmit`, every `test:*` script (including `test:fulfillment`, 27 tests) and `next build` all PASS. Fix any failure before continuing. Do not touch the files listed under Global Constraints.

- [ ] **Step 2: Get the user's go-ahead to apply the migration**

Stop and ask the user before touching the database. Tell them: the migration is additive (new columns, three new tables, one private bucket, seven functions, and one value written to a new column on already-approved bookings), and it must be applied before the app is deployed. Offer two routes and let them choose:
1. Apply it to a Supabase development branch first (`create_branch`, which may cost money), test there, then merge.
2. Apply it straight to the live project.

Do not run either until they answer. (Memory note: the live database has drifted from the migrations before, so check `list_migrations` first and read `20260909000000_restore_manual_payment_submission_columns.sql` if anything looks off.)

- [ ] **Step 3: Apply the migration (after approval)**

Use the Supabase MCP `apply_migration` tool (load its schema with `ToolSearch` query `select:mcp__claude_ai_Supabase__apply_migration,mcp__claude_ai_Supabase__list_projects,mcp__claude_ai_Supabase__execute_sql,mcp__claude_ai_Supabase__list_migrations`) with the file contents of `supabase/migrations/20260921120000_rental_fulfillment.sql` and the name `rental_fulfillment`. If the Supabase connector is not authorized in the session, tell the user it needs authorizing in their claude.ai connector settings, or ask them to run the file in the Supabase SQL editor.

- [ ] **Step 4: Check the schema landed**

Run each query with `execute_sql` and compare with the expected result:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'bookings'
  and column_name in ('approval_email_status','approval_email_sent_at','completion_email_sent_at','completion_email_to');
-- expected: 4 rows

select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('booking_fulfillment_records','booking_charges','booking_customer_updates');
-- expected: 3 rows

select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_record_pickup','admin_record_return','admin_save_item_condition',
                    'admin_add_booking_charge','admin_mark_charge_paid','admin_void_booking_charge','admin_complete_rental');
-- expected: 7 rows

select id, public from storage.buckets where id = 'condition-photos';
-- expected: 1 row, public = false

select count(*) from public.bookings where approved_at is not null and approval_email_status is null;
-- expected: 0
```

If the migration failed at a call to `private.log_audit_event` or `admin_set_booking_status`, re-check the signatures per Task 3 Step 2 and fix the migration file, then re-apply.

- [ ] **Step 5: Start the app and test each flow in the browser**

Run `npm run dev`, sign in as an admin, and work through this checklist. Use one test booking per scenario. Check each item off only after seeing it happen.

Gate and legacy:
- [ ] An already-approved booking opens **Rental Fulfillment** (not the old tabs), with the notice "Confirmation email status unavailable" and a working **Resend Email**. After a successful resend the notice is gone.
- [ ] A new pending booking still shows the old review tabs.
- [ ] Approve a new booking with email configured: the page switches to Rental Fulfillment and the toast says the email was sent.
- [ ] Approve a new booking with `RESEND_API_KEY` blank: the old tabs stay, the "Confirmation Email Not Sent" popup appears, and after fixing the key and using **Resend Email** the page switches.
- [ ] A customer cancellation request panel is still visible in Fulfillment mode.

Follow-up strip:
- [ ] On an approved booking with a pending payment proof, missing document approval and an unsigned agreement, the strip lists exactly those items plus "Confirm the booking", each with its working control.
- [ ] After payment, documents and agreement are done and the booking is Confirmed, then Ready for Handover, the strip disappears entirely (no empty box, no "all done" text).

Pickup, return, condition:
- [ ] With an unpaid balance and no pay-later exception, **Mark as Picked Up** is disabled with the balance message. After the balance is verified it works, the booking shows Released to Customer, and the customer notification appears.
- [ ] **Return** is unavailable until pickup, rejects a time earlier than the pickup, and rejects a future time.
- [ ] **Item Condition**: "Has Damage" without notes is rejected. Upload two photos (JPG and PNG), save, reload, and the photos still show. A PDF and a file over 5 MB are rejected with a plain message.

Charges:
- [ ] Add a Late Fee with an amount you type. The summary says "Customer still owes ...". Add a second charge of type Other.
- [ ] **Mark as paid** with GCash: the card shows the method, the date and the admin's name.
- [ ] **Void** the other charge with a reason: it shows struck through and no longer counts. There is no delete button anywhere.
- [ ] With everything paid or voided, the summary says "Nothing owed. Fully paid."

Customer updates:
- [ ] Use the "Remaining balance" starter: the amount is filled in and editable. **Send to customer** stays disabled until you click **Preview message**; editing the text afterwards disables it again.
- [ ] Send with a working email key: the history row says Sent with the time and recipient.
- [ ] Blank the email key and send: the row says Not sent. Restore the key and click **Resend**: the same row becomes Sent, no second row appears, and the linked charge is unchanged.

Complete Rental:
- [ ] With an unpaid charge, no return, or a payment proof waiting, the button is disabled and each reason is listed in plain words.
- [ ] Complete a signed-in customer's rental that is not yet at the loyalty threshold: the booking shows **Completed** (not "Returned") in the badge, and the customer email arrives with name, booking number, items, completed date, charge and payment summary, a "X of N rentals" loyalty line, and a thank-you.
- [ ] Complete a rental that makes the customer's completed count reach the threshold: the email says the reward is unlocked. Compare the amount with `LOYALTY_REWARD_DISCOUNT` in `src/lib/promotions.ts`.
- [ ] Complete a **guest checkout** rental: the email has no loyalty section.
- [ ] Refresh the page, reopen the booking, and click nothing else: the booking is still Completed and no second email arrived. In the SQL editor, run `select count(*) from public.booking_status_history where booking_id = '<id>' and to_status = 'returned';` and confirm it is `1`. Call `POST /api/admin/bookings/<id>/complete` again from the browser console and confirm the response has `alreadyCompleted: true` and the customer receives no second email.
- [ ] Blank the email key and complete another rental: it still shows Completed, the panel says the customer has not received the email, and **Resend Email** sends it once the key is restored.
- [ ] `PATCH /api/admin/bookings/<id>` with `{ "status": "returned" }` from the console returns 409 with the "Use Complete Rental" message.

Record, look and feel:
- [ ] **View Booking Record** shows customer details, payments and proofs, receipts, documents, the agreement with the **final agreement PDF** button, email history, and status history, with no action controls other than opening files.
- [ ] Nothing in the new UI contains an arrow glyph or icon or a live-update indicator, fonts are Poppins and colors match the existing admin pages.
- [ ] At a phone width (about 390 px) the tabs wrap, forms are usable, and there is no horizontal page scroll.

- [ ] **Step 6: Report**

Tell the user exactly what passed and what did not, including any checklist item you could not run (for example, no way to receive email in the environment). List the four planning decisions from the top of this plan that affect them, and remind them that other admins viewing the same booking see changes after a refresh, because the new tables are not part of the realtime publication.

## Known limits (accepted)

- A photo uploaded and then removed before saving stays in the private bucket unreferenced. Nothing is deleted automatically.
- Voiding an already-paid charge keeps the record and stops it counting; any refund is handled outside the app.
- The new tables are not added to the realtime publication; the page refreshes after each action in the same browser.
- The completion RPC requires verified payments of at least the booking total even when a pay-later exception was approved for handover.

