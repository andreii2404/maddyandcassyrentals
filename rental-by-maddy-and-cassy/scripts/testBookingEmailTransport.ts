import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSupabaseEmailRequest,
  DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME,
} from "../src/lib/emailFunctionTransport";
import {
  buildEmailNotificationQueueRow,
  buildSignedAgreementQueueRow,
  buildPaymentRejectionQueueRow,
} from "../src/lib/emailNotificationQueue";
import { buildPaymentRejectionEmail } from "../src/lib/paymentRejectionEmail";

test("sends booking email through the configured Supabase Edge Function", async () => {
  const request = buildSupabaseEmailRequest(
    {
      supabaseUrl: "https://project.supabase.co",
      functionName: DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME,
      serviceKey: "service-role-test-key",
    },
    {
      to: "customer@example.com",
      subject: "Booking BK-001 approved",
      html: "<p>Approved</p>",
      text: "Approved",
    },
  );

  assert.equal(request.url, "https://project.supabase.co/functions/v1/send-booking-emails");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(request.init.headers, {
    apikey: "service-role-test-key",
    Authorization: "Bearer service-role-test-key",
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    to: "customer@example.com",
    subject: "Booking BK-001 approved",
    html: "<p>Approved</p>",
    text: "Approved",
  });
});

test("queues the booking email in the schema used by send-booking-emails", () => {
  assert.deepEqual(
    buildEmailNotificationQueueRow(
      {
        bookingId: "booking-1",
        bookingReference: "BK-001",
        customerName: " Customer Example ",
        customerEmail: "customer@example.com",
        status: "approved",
        statusChangedAt: "2026-09-26T00:00:00.000Z",
        bookingUrl: "https://example.com/account/bookings/booking-1",
      },
      "Booking BK-001 approved",
    ),
    {
      booking_id: "booking-1",
      event_key: "booking-approved-booking-1-2026-09-26T00:00:00.000Z",
      email_type: "booking_approved",
      recipient_email: "customer@example.com",
      recipient_name: "Customer Example",
      subject: "Booking BK-001 approved",
      status: "pending",
    },
  );
});

test("queues a signed agreement email with the contract email type", () => {
  assert.deepEqual(
    buildSignedAgreementQueueRow({
      bookingId: "booking-1",
      recipientEmail: "customer@example.com",
      recipientName: "Customer Example",
      subject: "Booking BK-001 confirmation & signed contract",
    }),
    {
      booking_id: "booking-1",
      event_key: "booking-confirmation-contract-booking-1",
      email_type: "booking_confirmation_contract",
      recipient_email: "customer@example.com",
      recipient_name: "Customer Example",
      subject: "Booking BK-001 confirmation & signed contract",
      status: "pending",
    },
  );
});

test("queues one payment rejection email with the booking, recipient, and reason", () => {
  const details = {
    bookingId: "booking-1",
    paymentId: "payment-1",
    bookingReference: "BK-001",
    customerName: "Customer Example",
    customerEmail: "customer@example.com",
    rejectionReason: "The uploaded proof is not readable.",
    bookingUrl: "https://example.com/account/bookings/2d48e851-0e3f-4b74-9646-307f92e8789c",
  };

  assert.deepEqual(buildPaymentRejectionQueueRow(details, "Payment proof rejected for BK-001"), {
    booking_id: "booking-1",
    event_key: "payment-rejected-payment-1",
    email_type: "payment_rejected",
    recipient_email: "customer@example.com",
    recipient_name: "Customer Example",
    subject: "Payment proof rejected for BK-001",
    status: "pending",
  });

  const email = buildPaymentRejectionEmail(details);
  assert.equal(email.subject, "Payment Rejected – Booking BK-001");
  assert.match(email.text, /Hi Customer,/);
  assert.match(email.text, /Your payment proof for booking BK-001 has been rejected\./);
  assert.match(email.text, /Rejection Reason:\nThe uploaded proof is not readable\./);
  assert.match(email.text, /submit a new payment proof/i);
  assert.match(email.html, />Payment Proof Rejected</);
  assert.match(email.html, />Customer Example</);
  assert.match(email.html, />BK-001</);
  assert.match(email.html, />Resubmit Payment</);
  assert.match(email.html, /href="https:\/\/example\.com\/account\/bookings\/2d48e851-0e3f-4b74-9646-307f92e8789c"/);
  assert.doesNotMatch(email.html, /href="[^"]*BK-001/);
  assert.match(email.html, /Maddy &amp; Cassy/);
  assert.match(email.html, /This is an automatic update for booking/);
});
