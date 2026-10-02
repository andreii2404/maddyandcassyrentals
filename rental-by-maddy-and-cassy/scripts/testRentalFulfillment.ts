import test from "node:test";
import assert from "node:assert/strict";
import {
  activeCharges,
  buildEmailHistory,
  computeAmountOwed,
  DEPOSIT_METHOD_LABELS,
  getCompletionBlockers,
  getFollowUpItems,
  isFulfillmentMode,
  SECURITY_DEPOSIT_AMOUNT,
  validateConditionPhoto,
  validateSecurityDepositInput,
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
  securityDepositPaid: true,
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
    securityDepositPaid: false,
    returned: false,
    itemCondition: null,
    charges: [charge({ amount: 500 })],
    verifiedPaid: 2000,
    pendingPaymentReviews: 2,
  });
  assert.equal(blockers.length, 6);
  assert.match(blockers.join(" "), /PHP 1,000 security deposit/);
  assert.match(blockers.join(" "), /return/i);
  assert.match(blockers.join(" "), /condition/i);
  assert.match(blockers.join(" "), /PHP 500/);
  assert.match(blockers.join(" "), /2 payment/);
});

test("an unpaid security deposit alone blocks completion", () => {
  const blockers = getCompletionBlockers({ ...readyToComplete, securityDepositPaid: false });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /security deposit/);
  // The Complete Rental tab routes each blocker to its tab by keyword; this one must not be
  // mistaken for the Pickup, Return, Item Condition or Charges blockers.
  assert.doesNotMatch(blockers[0], /Pickup|return|condition|charge|balance/i);
});

test("the security deposit is a fixed PHP 1,000 with four payment methods", () => {
  assert.equal(SECURITY_DEPOSIT_AMOUNT, 1000);
  assert.deepEqual(DEPOSIT_METHOD_LABELS, {
    gcash: "GCash",
    maya: "Maya",
    bank_transfer: "Bank Transfer",
    cash: "Cash",
  });
});

test("digital deposit payments need a valid reference number; cash does not", () => {
  for (const method of ["gcash", "maya", "bank_transfer"]) {
    assert.match(validateSecurityDepositInput({ method, referenceNumber: "" }) ?? "", /reference number/i);
    assert.match(validateSecurityDepositInput({ method, referenceNumber: "   " }) ?? "", /reference number/i);
    assert.ok(validateSecurityDepositInput({ method, referenceNumber: "abc" }), "too short");
    assert.ok(validateSecurityDepositInput({ method, referenceNumber: "12 34 56" }), "spaces are not allowed");
    assert.ok(validateSecurityDepositInput({ method, referenceNumber: "x".repeat(121) }), "too long");
    assert.equal(validateSecurityDepositInput({ method, referenceNumber: "1234567890123" }), null);
    assert.equal(validateSecurityDepositInput({ method, referenceNumber: "BT-2026-0042" }), null);
  }
  assert.equal(validateSecurityDepositInput({ method: "cash", referenceNumber: "" }), null);
  assert.equal(validateSecurityDepositInput({ method: "cash", referenceNumber: "ignored" }), null);
});

test("unknown deposit payment methods are rejected", () => {
  for (const method of ["other", "paypal", "", null, undefined, 1, "toString", "constructor"]) {
    assert.match(validateSecurityDepositInput({ method, referenceNumber: "1234567890" }) ?? "", /GCash, Maya/);
  }
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
