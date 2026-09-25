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
