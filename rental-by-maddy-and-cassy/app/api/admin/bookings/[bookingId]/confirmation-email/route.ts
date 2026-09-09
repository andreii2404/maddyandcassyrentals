import { NextResponse } from "next/server";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { bookingHeadline } from "@/src/lib/bookingDisplay";
import { sendBookingStatusEmail } from "@/src/lib/server/bookingStatusEmail";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVED_BOOKING_STATUSES = new Set([
  "approved",
  "confirmed",
  "ready_for_release",
  "released",
]);

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function formatDate(value: string): string {
  return value
    ? new Date(value).toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Not provided";
}

function formatCurrency(value: number): string {
  return `PHP ${value.toLocaleString("en-PH")}`;
}

function formatStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-confirmation-email", 10, 60_000);
    await requireActiveAdmin();
    const { bookingId } = await params;
    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);

    if (!booking) return errorResponse("The selected booking could not be found.", 404);
    if (!APPROVED_BOOKING_STATUSES.has(booking.status)) {
      return errorResponse("The booking confirmation email is available after the booking has been approved.", 409);
    }

    const [{ data: paymentRows, error: paymentError }, { data: authUser }] = await Promise.all([
      admin.from("booking_payment_submissions").select("declared_amount, status").eq("booking_id", bookingId),
      admin.auth.admin.getUserById(booking.customerId),
    ]);
    if (paymentError) return errorResponse("The booking payment status could not be loaded.", 503);

    const amountPaid = (paymentRows ?? [])
      .filter((payment) => payment.status === "verified")
      .reduce((sum, payment) => sum + payment.declared_amount, 0);
    const remainingBalance = Math.max(0, booking.totalAmount - amountPaid);
    const paymentStatus = amountPaid <= 0
      ? "Unpaid"
      : remainingBalance > 0.01
        ? "Partially Paid"
        : "Paid";
    const remainingActions: string[] = [];
    if (remainingBalance > 0.01) {
      remainingActions.push(
        booking.payLaterAllowed
          ? "Pay the remaining balance according to the approved pay-later arrangement before handover"
          : "Pay the remaining balance before handover",
      );
    }
    if (booking.requirementsStatus !== "approved") remainingActions.push("Complete verification documents");
    if (booking.agreementStatus !== "completed") remainingActions.push("Complete the rental agreement");

    const customerEmail = booking.customerSnapshot.email.trim() || authUser.user?.email?.trim() || "";
    const emailResult = await sendBookingStatusEmail({
      bookingId,
      bookingReference: booking.bookingRef,
      customerName: booking.customerSnapshot.fullName || "Customer",
      customerEmail,
      productName: bookingHeadline(booking.items),
      status: "approved",
      statusChangedAt: booking.approvedAt || booking.updatedAt,
      bookingUrl: `${new URL(request.url).origin}${bookingTrackingPath(booking.id, booking.isGuestCheckout)}`,
      isGuest: booking.isGuestCheckout,
      rentalDates: `${formatDate(booking.startDate)} - ${formatDate(booking.endDate)} (${booking.dayCount} day${booking.dayCount === 1 ? "" : "s"})`,
      paymentStatus,
      amountPaid: formatCurrency(amountPaid),
      remainingBalance: formatCurrency(remainingBalance),
      fulfillmentMethod: formatStatus(booking.fulfillmentMethod),
      remainingAction: remainingActions.length ? remainingActions.join("; ") : "No remaining action is required before handover",
      deliveryKey: `booking-approved-manual-${booking.id}-${booking.approvedAt || booking.updatedAt}`,
    });

    if (!emailResult.sent) {
      if (emailResult.reason === "not_configured") {
        return errorResponse("Add RESEND_API_KEY and BOOKING_EMAIL_FROM to send booking confirmation emails.", 503);
      }
      if (emailResult.reason === "invalid_recipient") {
        return errorResponse("The customer does not have a valid email address on this booking.", 422);
      }
      return errorResponse("The booking confirmation email could not be delivered. Please try again.", 502);
    }

    return NextResponse.json({ success: true, emailedTo: customerEmail });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Admin booking confirmation email failed", error);
    return errorResponse("The booking confirmation email could not be sent.", 500);
  }
}
