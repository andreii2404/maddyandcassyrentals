import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSupabaseEmailRequest,
  DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME,
} from "../src/lib/emailFunctionTransport";
import {
  buildEmailNotificationQueueRow,
  buildSignedAgreementQueueRow,
} from "../src/lib/emailNotificationQueue";

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
      email_type: "booking_confirmation_contract",
      recipient_email: "customer@example.com",
      recipient_name: "Customer Example",
      subject: "Booking BK-001 confirmation & signed contract",
      status: "pending",
    },
  );
});
