import "server-only";

import {
  buildBookingStatusEmail,
  type BookingStatusEmailDetails,
} from "@/src/lib/bookingStatusEmailContent";
import {
  buildSupabaseEmailRequest,
  DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME,
} from "@/src/lib/emailFunctionTransport";
import {
  buildEmailNotificationQueueRow,
  buildPaymentRejectionQueueRow,
  buildPaymentVerifiedQueueRow,
  type PaymentRejectionEmailDetails,
} from "@/src/lib/emailNotificationQueue";
import { buildPaymentRejectionEmail } from "@/src/lib/paymentRejectionEmail";
import { buildPaymentVerifiedEmail, type PaymentVerifiedEmailDetails } from "@/src/lib/paymentVerificationEmail";
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
  const email = buildBookingStatusEmail(details);
  const queueRow = buildEmailNotificationQueueRow(details, email.subject);
  return sendQueuedBookingEmail({
    bookingId: details.bookingId,
    customerEmail: details.customerEmail,
    status: details.status,
    email,
    queueRow,
    eventKey: queueRow.event_key,
  });
}

export async function sendPaymentRejectionEmail(
  details: PaymentRejectionEmailDetails,
): Promise<BookingStatusEmailResult> {
  const email = buildPaymentRejectionEmail(details);
  const queueRow = buildPaymentRejectionQueueRow(details, email.subject);
  return sendQueuedBookingEmail({
    bookingId: details.bookingId,
    customerEmail: details.customerEmail,
    status: "rejected",
    email,
    queueRow,
    eventKey: queueRow.event_key,
  });
}

export async function sendPaymentVerifiedEmail(
  details: PaymentVerifiedEmailDetails,
): Promise<BookingStatusEmailResult> {
  const email = buildPaymentVerifiedEmail(details);
  const queueRow = buildPaymentVerifiedQueueRow(details, email.subject);
  return sendQueuedBookingEmail({
    bookingId: details.bookingId,
    customerEmail: details.customerEmail,
    status: "payment_verified",
    email,
    queueRow,
    eventKey: queueRow.event_key,
  });
}

async function sendQueuedBookingEmail(input: {
  bookingId: string;
  customerEmail: string;
  status: string;
  email: { subject: string; html: string; text: string };
  queueRow: { event_key: string } & object;
  eventKey: string;
}): Promise<BookingStatusEmailResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const functionName = process.env.SUPABASE_EMAIL_FUNCTION_NAME?.trim() || DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME;

  if (!supabaseUrl || !serviceKey) return { sent: false, reason: "not_configured" };
  if (!isEmail(input.customerEmail)) return { sent: false, reason: "invalid_recipient" };

  try {
    const queueClient = createAdminClient() as unknown as {
      from(table: string): {
        upsert(row: object, options: { onConflict: string; ignoreDuplicates: boolean }): Promise<{ error: { message?: string } | null }>;
      };
    };
    const { error: queueError } = await queueClient
      .from("email_notifications")
      .upsert(input.queueRow, { onConflict: "event_key", ignoreDuplicates: true });

    if (queueError) {
      console.error("Booking status email could not be queued", {
        bookingId: input.bookingId,
        eventKey: input.eventKey,
        source: "server.bookingStatusEmail",
        error: queueError.message,
      });
      return { sent: false, reason: "provider_error" };
    }
    console.info("Booking email event queued", {
      source: "server.bookingStatusEmail",
      bookingId: input.bookingId,
      eventKey: input.eventKey,
      status: input.status,
    });
  } catch (error) {
    console.error("Booking status email queue request failed", {
      bookingId: input.bookingId,
      eventKey: input.eventKey,
      source: "server.bookingStatusEmail",
      error: error instanceof Error ? error.message : "Unknown queue error",
    });
    return { sent: false, reason: "provider_error" };
  }

  const request = buildSupabaseEmailRequest(
    { supabaseUrl, functionName, serviceKey },
    {
      to: input.customerEmail,
      eventKey: input.eventKey,
      subject: input.email.subject,
      html: input.email.html,
      text: input.email.text,
    },
  );

  try {
    const response = await fetch(request.url, request.init);

    const payload = (await response.json().catch(() => null)) as
      | { id?: unknown; success?: unknown; error?: unknown; message?: unknown }
      | null;
    if (!response.ok || payload?.success !== true || payload.message === "No pending emails.") {
      console.error("Booking status email provider rejected the request", {
        bookingId: input.bookingId,
        eventKey: input.eventKey,
        status: input.status,
        providerStatus: response.status,
        providerError: typeof payload?.error === "string" ? payload.error : undefined,
        providerMessage: typeof payload?.message === "string" ? payload.message : undefined,
      });
      return { sent: false, reason: "provider_error" };
    }

    return { sent: true, providerId: typeof payload.id === "string" ? payload.id : undefined };
  } catch (error) {
    console.error("Booking status email request failed", {
      bookingId: input.bookingId,
      status: input.status,
      error: error instanceof Error ? error.message : "Unknown provider error",
    });
    return { sent: false, reason: "provider_error" };
  }
}
