import "server-only";

import { buildApprovalEmailDetails } from "@/src/lib/bookingApprovalEmailDetails";
import {
  isBookingEmailConfigured,
  missingBookingEmailSettings,
  sendBookingStatusEmail,
  type BookingStatusEmailResult,
} from "@/src/lib/server/bookingStatusEmail";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";

// Statuses a booking passes through after approval. The confirmation email can be
// re-sent while the booking is still in any of them.
const APPROVED_BOOKING_STATUSES = new Set(["approved", "confirmed", "ready_for_release", "released"]);

export interface BookingApprovalEmailOutcome {
  sent: boolean;
  emailedTo?: string;
  reason?: NonNullable<BookingStatusEmailResult["reason"]> | "not_found" | "not_approved" | "load_failed";
}

interface SendBookingApprovalEmailOptions {
  bookingId: string;
  origin: string;
  /**
   * A manual re-send gets its own delivery key so the email provider does not
   * silently de-duplicate it against the original send.
   */
  resend?: boolean;
}

/**
 * Sends the Approval Confirmation email for a booking to the email saved on it
 * (guest checkout included). Never throws: the booking approval is already saved by
 * the time this runs, so every failure is logged server-side and returned as an
 * outcome for the caller to turn into a friendly message.
 */
export async function sendBookingApprovalEmail({
  bookingId,
  origin,
  resend = false,
}: SendBookingApprovalEmailOptions): Promise<BookingApprovalEmailOutcome> {
  try {
    const missingSettings = missingBookingEmailSettings();
    if (!isBookingEmailConfigured() || missingSettings.length > 0) {
      console.error("Booking emails are not configured. Set the missing server settings.", { missingSettings });
      return { sent: false, reason: "not_configured" };
    }

    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);
    if (!booking) return { sent: false, reason: "not_found" };
    if (resend && !APPROVED_BOOKING_STATUSES.has(booking.status)) {
      return { sent: false, reason: "not_approved" };
    }

    const { data: paymentRows, error: paymentError } = await admin
      .from("booking_payment_submissions")
      .select("declared_amount, status")
      .eq("booking_id", bookingId);
    if (paymentError) {
      console.error("Approval email could not load payments", { bookingId, error: paymentError.message });
      return { sent: false, reason: "load_failed" };
    }

    let fallbackEmail: string | null = null;
    if (!booking.customerSnapshot.email.trim()) {
      const { data: authUser } = await admin.auth.admin.getUserById(booking.customerId);
      fallbackEmail = authUser?.user?.email ?? null;
    }

    const stamp = booking.approvedAt || booking.updatedAt;
    const details = buildApprovalEmailDetails({
      booking,
      payments: (paymentRows ?? []).map((row) => ({
        declaredAmount: row.declared_amount,
        status: row.status,
      })),
      fallbackEmail,
      origin,
      deliveryKey: resend
        ? `booking-approved-resend-${booking.id}-${Date.now()}`
        : `booking-approved-${booking.id}-${stamp}`,
    });

    const result = await sendBookingStatusEmail(details);
    return result.sent
      ? { sent: true, emailedTo: details.customerEmail }
      : { sent: false, reason: result.reason };
  } catch (error) {
    console.error("Approval email failed unexpectedly", {
      bookingId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { sent: false, reason: "load_failed" };
  }
}
