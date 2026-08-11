import "server-only";

import {
  buildBookingStatusEmail,
  type BookingStatusEmailDetails,
} from "@/src/lib/bookingStatusEmailContent";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export interface BookingStatusEmailResult {
  sent: boolean;
  providerId?: string;
  reason?: "not_configured" | "invalid_recipient" | "provider_error";
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isBookingEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.BOOKING_EMAIL_FROM?.trim());
}

export async function sendBookingStatusEmail(
  details: BookingStatusEmailDetails,
): Promise<BookingStatusEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.BOOKING_EMAIL_FROM?.trim();
  const replyTo = process.env.BOOKING_EMAIL_REPLY_TO?.trim();

  if (!apiKey || !from) return { sent: false, reason: "not_configured" };
  if (!isEmail(details.customerEmail)) return { sent: false, reason: "invalid_recipient" };

  const email = buildBookingStatusEmail(details);
  const idempotencyKey = `booking-${details.status}-${details.bookingId}-${details.statusChangedAt}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 256);

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
        to: [details.customerEmail],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        tags: [
          { name: "booking_status", value: details.status },
          { name: "booking_reference", value: details.bookingReference.replace(/[^a-zA-Z0-9_-]/g, "-") },
        ],
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
    if (!response.ok || typeof payload?.id !== "string") {
      console.error("Booking status email provider rejected the request", {
        bookingId: details.bookingId,
        status: details.status,
        providerStatus: response.status,
      });
      return { sent: false, reason: "provider_error" };
    }

    return { sent: true, providerId: payload.id };
  } catch (error) {
    console.error("Booking status email request failed", {
      bookingId: details.bookingId,
      status: details.status,
      error: error instanceof Error ? error.message : "Unknown provider error",
    });
    return { sent: false, reason: "provider_error" };
  }
}
