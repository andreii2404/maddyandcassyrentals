import assert from "node:assert/strict";
import test from "node:test";

import { buildPaymentVerifiedEmail } from "../src/lib/paymentVerificationEmail";
import { buildPaymentVerifiedQueueRow } from "../src/lib/emailNotificationQueue";

const baseDetails = {
  bookingId: "booking-1",
  paymentId: "payment-1",
  bookingReference: "BK-001",
  customerName: "Customer Example",
  customerEmail: "customer@example.com",
  bookingUrl: "https://example.com/account/bookings/booking-1#booking-documents",
};

test("payment verification email asks for documents when the authoritative status is not_submitted", () => {
  const email = buildPaymentVerifiedEmail({
    ...baseDetails,
    requirementsStatus: "not_submitted",
  });

  assert.match(email.text, /payment for booking BK-001 was verified/i);
  assert.match(email.text, /required verification documents are still pending/i);
  assert.match(email.text, /not fully approved or secured/i);
  assert.match(email.text, /Submit Verification Documents: https:\/\/example\.com\/account\/bookings\/booking-1#booking-documents/);
  assert.match(email.html, />Submit Verification Documents</);
  assert.match(email.html, /href="https:\/\/example\.com\/account\/bookings\/booking-1#booking-documents"/);
});

test("payment verification email stays concise when documents were already submitted", () => {
  const email = buildPaymentVerifiedEmail({
    ...baseDetails,
    requirementsStatus: "pending_review",
  });

  assert.match(email.text, /payment for booking BK-001 was verified/i);
  assert.doesNotMatch(email.text, /documents are still pending|not fully approved or secured|Submit Verification Documents/i);
  assert.doesNotMatch(email.html, /Submit Verification Documents|not fully approved or secured/i);
});

test("payment verification queue row preserves the shared booking document state", () => {
  assert.deepEqual(
    buildPaymentVerifiedQueueRow(
      {
        ...baseDetails,
        requirementsStatus: "not_submitted",
      },
      "Payment verified for BK-001",
    ),
    {
      booking_id: "booking-1",
      event_key: "payment-verified-payment-1",
      email_type: "payment_verified",
      recipient_email: "customer@example.com",
      recipient_name: "Customer Example",
      subject: "Payment verified for BK-001",
      status: "pending",
    },
  );
});
