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
  /** Human-readable failure detail from the provider or thrown error. Safe to log; surfaced to admins only outside production. */
  detail?: string;
}

/** Shape of a Resend POST /emails response: `{ id }` on success, `{ name, message }` on error. */
interface ResendEmailResponse {
  id?: unknown;
  name?: unknown;
  message?: unknown;
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

  if (!apiKey || !from) {
    return {
      sent: false,
      reason: "not_configured",
      detail: "RESEND_API_KEY and BOOKING_EMAIL_FROM must be set (see .env.example). For local development, use a Resend API key and a verified sender, or 'onboarding@resend.dev'.",
    };
  }
  if (!isEmail(customerEmail)) {
    return { sent: false, reason: "invalid_recipient", detail: `Recipient address is not a valid email: "${customerEmail}".` };
  }

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

    const rawBody = await response.text();
    let payload: ResendEmailResponse | null = null;
    try {
      payload = rawBody ? (JSON.parse(rawBody) as ResendEmailResponse) : null;
    } catch {
      payload = null;
    }

    if (!response.ok || typeof payload?.id !== "string") {
      const providerMessage =
        typeof payload?.message === "string" && payload.message.trim()
          ? payload.message.trim()
          : rawBody.slice(0, 500) || `HTTP ${response.status}`;
      const detail = `Resend responded ${response.status}${
        typeof payload?.name === "string" ? ` (${payload.name})` : ""
      }: ${providerMessage}`;
      console.error("Receipt email provider rejected the request", {
        bookingReference: details.bookingReference,
        providerStatus: response.status,
        detail,
      });
      return { sent: false, reason: "provider_error", detail };
    }

    return { sent: true, providerId: payload.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown provider error";
    console.error("Receipt email request failed", {
      bookingReference: details.bookingReference,
      error: detail,
    });
    return { sent: false, reason: "provider_error", detail };
  }
}
