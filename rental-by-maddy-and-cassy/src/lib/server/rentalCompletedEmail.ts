import "server-only";

import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { mapCharge } from "@/src/lib/fulfillmentMappers";
import { getLoyaltyEmailOutcome, type LoyaltyEmailOutcome } from "@/src/lib/loyaltyOutcome";
import { buildRentalCompletedEmail } from "@/src/lib/rentalCompletedEmailContent";
import { activeCharges, CHARGE_TYPE_LABELS } from "@/src/lib/rentalFulfillment";
import { isBookingEmailConfigured, missingBookingEmailSettings } from "@/src/lib/server/bookingStatusEmail";
import { resolveBookingRecipientEmail } from "@/src/lib/server/bookingRecipient";
import { safeTagValue, sendEmail, type EmailSendResult } from "@/src/lib/server/emailTransport";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById, getCustomerRewardProgress } from "@/src/services/bookingService";

export interface CompletionEmailOutcome {
  sent: boolean;
  emailedTo?: string;
  reason?: EmailSendResult["reason"] | "not_found" | "not_completed" | "load_failed";
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Sends the Rental Completed email and saves when and where it went. Never throws: the rental is
 * already Completed by the time this runs, so a failure is logged and returned so the admin can
 * use Resend Email. The first send uses a stable delivery key so a retried request cannot email
 * the customer twice.
 */
export async function sendRentalCompletedEmail({
  bookingId,
  origin,
  resend = false,
}: {
  bookingId: string;
  origin: string;
  resend?: boolean;
}): Promise<CompletionEmailOutcome> {
  try {
    const missingSettings = missingBookingEmailSettings();
    if (!isBookingEmailConfigured() || missingSettings.length > 0) {
      console.error("Booking emails are not configured. Set the missing server settings.", { missingSettings });
      return { sent: false, reason: "not_configured" };
    }

    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);
    if (!booking) return { sent: false, reason: "not_found" };
    if (booking.status !== "returned") return { sent: false, reason: "not_completed" };

    const [paymentsResult, chargesResult] = await Promise.all([
      admin.from("booking_payment_submissions").select("declared_amount, status").eq("booking_id", bookingId),
      admin.from("booking_charges").select("*").eq("booking_id", bookingId),
    ]);
    if (paymentsResult.error || chargesResult.error) {
      console.error("Completion email could not load payments or charges", {
        bookingId,
        error: paymentsResult.error?.message ?? chargesResult.error?.message,
      });
      return { sent: false, reason: "load_failed" };
    }

    const verifiedPaid = (paymentsResult.data ?? [])
      .filter((row) => row.status === "verified")
      .reduce((sum, row) => sum + row.declared_amount, 0);
    const charges = activeCharges((chargesResult.data ?? []).map(mapCharge));
    const chargesTotal = charges.reduce((sum, charge) => sum + charge.amount, 0);
    const paidCharges = charges
      .filter((charge) => charge.paymentStatus === "paid")
      .reduce((sum, charge) => sum + charge.amount, 0);
    const totalPaid = round2(verifiedPaid + paidCharges);
    const balance = Math.max(0, round2(booking.totalAmount + chargesTotal - totalPaid));

    let loyalty: LoyaltyEmailOutcome = { kind: "none" };
    if (!booking.isGuestCheckout) {
      try {
        const progress = await getCustomerRewardProgress(admin, booking.customerId);
        loyalty = getLoyaltyEmailOutcome({
          isGuest: false,
          completedRentals: progress.completedRentals,
          loyaltyRewardUsed: progress.loyaltyRewardUsed,
          thisBookingRewardAmount: booking.loyaltyDiscountAmount,
        });
      } catch (error) {
        // The email is still worth sending without a loyalty section.
        console.error("Completion email could not load loyalty progress", {
          bookingId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const customerEmail = await resolveBookingRecipientEmail(admin, booking);
    const email = buildRentalCompletedEmail({
      bookingId: booking.id,
      bookingReference: booking.bookingRef,
      customerName: booking.customerSnapshot.fullName.trim() || "Customer",
      customerEmail,
      items: booking.items.map((item) => ({ name: item.productName, quantity: item.quantity })),
      completedAt: booking.returnedAt ?? booking.updatedAt,
      bookingUrl: `${origin}${bookingTrackingPath(booking.id, booking.isGuestCheckout)}`,
      isGuest: booking.isGuestCheckout,
      rentalTotal: booking.totalAmount,
      charges: charges.map((charge) => ({ label: CHARGE_TYPE_LABELS[charge.chargeType], amount: charge.amount })),
      totalPaid,
      balance,
      loyalty,
    });

    const result = await sendEmail({
      to: customerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: resend
        ? `booking-completed-resend-${booking.id}-${Date.now()}`
        : `booking-completed-${booking.id}`,
      tags: [
        { name: "booking_status", value: "completed" },
        { name: "booking_reference", value: safeTagValue(booking.bookingRef) },
      ],
      logContext: { bookingId: booking.id, status: "completed" },
    });
    if (!result.sent) return { sent: false, reason: result.reason };

    const { error: saveError } = await admin
      .from("bookings")
      .update({ completion_email_sent_at: new Date().toISOString(), completion_email_to: customerEmail })
      .eq("id", bookingId);
    if (saveError) {
      console.error("Completion email status could not be saved", { bookingId, error: saveError.message });
    }
    return { sent: true, emailedTo: customerEmail };
  } catch (error) {
    console.error("Completion email failed unexpectedly", {
      bookingId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { sent: false, reason: "load_failed" };
  }
}
