import "server-only";

import {
  buildBookingStatusEmail,
  type BookingStatusEmailDetails,
} from "@/src/lib/bookingStatusEmailContent";
import {
  buildSupabaseEmailRequest,
  DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME,
} from "@/src/lib/emailFunctionTransport";
import { buildEmailNotificationQueueRow } from "@/src/lib/emailNotificationQueue";
import { createAdminClient } from "@/src/lib/supabase/admin";

export interface BookingStatusEmailResult {
  sent: boolean;
  providerId?: string;
  reason?: "not_configured" | "invalid_recipient" | "provider_error";
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isBookingEmailConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SECRET_KEY?.trim() &&
      (process.env.SUPABASE_EMAIL_FUNCTION_NAME?.trim() || DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME),
  );
}

/**
 * Names (never values) of the server settings a booking email needs but that are
 * empty. Server-console diagnostics only: admins never see these names.
 */
export function missingBookingEmailSettings(): string[] {
  return ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter((name) => !process.env[name]?.trim());
}

export async function sendBookingStatusEmail(
  details: BookingStatusEmailDetails,
): Promise<BookingStatusEmailResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const functionName = process.env.SUPABASE_EMAIL_FUNCTION_NAME?.trim() || DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME;

  if (!supabaseUrl || !serviceKey) return { sent: false, reason: "not_configured" };
  if (!isEmail(details.customerEmail)) return { sent: false, reason: "invalid_recipient" };

  const email = buildBookingStatusEmail(details);
  const queueRow = buildEmailNotificationQueueRow(details, email.subject);

  try {
    const queueClient = createAdminClient() as unknown as {
      from(table: string): {
        insert(row: typeof queueRow): Promise<{ error: { message?: string } | null }>;
      };
    };
    const { error: queueError } = await queueClient
      .from("email_notifications")
      .insert(queueRow);

    if (queueError) {
      console.error("Booking status email could not be queued", {
        bookingId: details.bookingId,
        error: queueError.message,
      });
      return { sent: false, reason: "provider_error" };
    }
  } catch (error) {
    console.error("Booking status email queue request failed", {
      bookingId: details.bookingId,
      error: error instanceof Error ? error.message : "Unknown queue error",
    });
    return { sent: false, reason: "provider_error" };
  }

  const request = buildSupabaseEmailRequest(
    { supabaseUrl, functionName, serviceKey },
    {
      to: details.customerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    },
  );

  try {
    const response = await fetch(request.url, request.init);

    const payload = (await response.json().catch(() => null)) as
      | { id?: unknown; success?: unknown; error?: unknown; message?: unknown }
      | null;
    if (!response.ok || payload?.success !== true || payload.message === "No pending emails.") {
      console.error("Booking status email provider rejected the request", {
        bookingId: details.bookingId,
        status: details.status,
        providerStatus: response.status,
        providerError: typeof payload?.error === "string" ? payload.error : undefined,
        providerMessage: typeof payload?.message === "string" ? payload.message : undefined,
      });
      return { sent: false, reason: "provider_error" };
    }

    return { sent: true, providerId: typeof payload.id === "string" ? payload.id : undefined };
  } catch (error) {
    console.error("Booking status email request failed", {
      bookingId: details.bookingId,
      status: details.status,
      error: error instanceof Error ? error.message : "Unknown provider error",
    });
    return { sent: false, reason: "provider_error" };
  }
}
