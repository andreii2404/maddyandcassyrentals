import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEmailNotificationQueueRow,
  buildPaymentRejectionQueueRow,
  buildPaymentVerifiedQueueRow,
} from "@/src/lib/emailNotificationQueue";

test("booking status queue rows carry a stable event key", () => {
  const row = buildEmailNotificationQueueRow(
    {
      bookingId: "booking-1",
      bookingReference: "B-1",
      customerName: "Customer",
      customerEmail: "customer@example.com",
      status: "approved",
      statusChangedAt: "2026-09-28T10:00:00.000Z",
      bookingUrl: "https://example.com/booking-1",
      deliveryKey: "booking-approved-booking-1-2026-09-28T10:00:00.000Z",
    },
    "subject",
  );

  assert.equal(row.event_key, "booking-approved-booking-1-2026-09-28T10:00:00.000Z");
});

test("payment queue rows use the payment submission as the event identity", () => {
  const verified = buildPaymentVerifiedQueueRow(
    {
      bookingId: "booking-1",
      paymentId: "payment-1",
      customerName: "Customer",
      customerEmail: "customer@example.com",
      requirementsStatus: "approved",
    },
    "subject",
  );
  const rejected = buildPaymentRejectionQueueRow(
    {
      bookingId: "booking-1",
      paymentId: "payment-2",
      bookingReference: "B-1",
      customerName: "Customer",
      customerEmail: "customer@example.com",
      rejectionReason: "Unreadable",
      isGuestCheckout: false,
    },
    "subject",
  );

  assert.equal(verified.event_key, "payment-verified-payment-1");
  assert.equal(rejected.event_key, "payment-rejected-payment-2");
});
