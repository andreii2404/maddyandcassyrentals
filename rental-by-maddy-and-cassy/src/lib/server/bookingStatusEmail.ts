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
