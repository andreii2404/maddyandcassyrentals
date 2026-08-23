import "server-only";

import { buildReceiptEmail, type ReceiptEmailDetails } from "@/src/lib/receiptEmailContent";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export interface ReceiptEmailAttachment {
  filename: string;
  /** Base64-encoded PDF bytes. */
  content: string;
}

export interface ReceiptEmailResult {
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

export async function sendReceiptEmail(
  customerEmail: string,
  details: ReceiptEmailDetails,
  attachment: ReceiptEmailAttachment | null,
): Promise<ReceiptEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.BOOKING_EMAIL_FROM?.trim();
  const replyTo = process.env.BOOKING_EMAIL_REPLY_TO?.trim();

  if (!apiKey || !from) return { sent: false, reason: "not_configured" };
  if (!isEmail(customerEmail)) return { sent: false, reason: "invalid_recipient" };

  const email = buildReceiptEmail(details);

  try {
    const response = await fetch(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [customerEmail],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachment ? { attachments: [attachment] } : {}),
        tags: [
          { name: "booking_reference", value: details.bookingReference.replace(/[^a-zA-Z0-9_-]/g, "-") },
        ],
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
    if (!response.ok || typeof payload?.id !== "string") {
      console.error("Receipt email provider rejected the request", {
        bookingReference: details.bookingReference,
        providerStatus: response.status,
      });
      return { sent: false, reason: "provider_error" };
    }

    return { sent: true, providerId: payload.id };
  } catch (error) {
    console.error("Receipt email request failed", {
      bookingReference: details.bookingReference,
      error: error instanceof Error ? error.message : "Unknown provider error",
    });
    return { sent: false, reason: "provider_error" };
  }
}
