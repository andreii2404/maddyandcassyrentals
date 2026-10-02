import "server-only";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export interface EmailSendResult {
  sent: boolean;
  providerId?: string;
  reason?: "not_configured" | "invalid_recipient" | "provider_error";
  providerStatus?: number;
  providerError?: string;
  detail?: string;
  retryAfterSeconds?: number;
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

function readRetryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (!value) return undefined;

  if (/^\d+$/.test(value)) return Number(value);

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt)
    ? undefined
    : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
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
      const providerError = typeof payload?.name === "string" ? payload.name : undefined;
      const providerMessage = typeof payload?.message === "string" ? payload.message : undefined;
      console.error("Booking email provider rejected the request", {
        ...message.logContext,
        providerStatus: response.status,
        providerError,
        providerMessage,
      });
      return {
        sent: false,
        reason: "provider_error",
        providerStatus: response.status,
        providerError,
        detail: providerMessage,
        ...(response.status === 429
          ? { retryAfterSeconds: readRetryAfterSeconds(response.headers) ?? 60 }
          : {}),
      };
    }
    return { sent: true, providerId: payload.id };
  } catch (error) {
    console.error("Booking email request failed", {
      ...message.logContext,
      error: error instanceof Error ? error.message : "Unknown provider error",
    });
    return {
      sent: false,
      reason: "provider_error",
      detail: error instanceof Error ? error.message : undefined,
    };
  }
}

/** Resend tag values may only contain letters, numbers, underscores and dashes. */
export function safeTagValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
