import { NextResponse } from "next/server";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";
import { isUuid } from "@/src/lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "booking-resume", 30, 60_000);
    const { user } = await requireUser();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return errorResponse("Choose a valid reservation to resume.", 400);

    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);
    if (!booking) return errorResponse("This reservation could not be found.", 404);
    if (booking.customerId !== user.id) {
      return errorResponse("You do not have access to this reservation.", 403);
    }

    const [{ data: payments, error: paymentsError }, { count: receiptCount, error: receiptError }] = await Promise.all([
      admin
        .from("booking_payment_submissions")
        .select("declared_amount, status, provider_metadata")
        .eq("booking_id", bookingId),
      admin
        .from("booking_receipts")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", bookingId),
    ]);
    if (paymentsError) throw paymentsError;
    if (receiptError) throw receiptError;

    const verifiedAmount = (payments ?? [])
      .filter((payment) => payment.status === "verified")
      .reduce((sum, payment) => sum + payment.declared_amount, 0);
    const hasPendingPayment = (payments ?? []).some((payment) =>
      ["submitted", "under_review"].includes(payment.status),
    );
    const paymentState =
      verifiedAmount <= 0
        ? hasPendingPayment
          ? "pending"
          : "unpaid"
        : verifiedAmount >= booking.totalAmount - 0.01
          ? "paid"
          : "partially_paid";
    const isDemoPayment = (payments ?? []).some(
      (payment) => (payment.provider_metadata as { demo?: boolean } | null)?.demo === true,
    );

    return NextResponse.json({
      success: true,
      paymentState,
      isDemoPayment,
      receiptReady: (receiptCount ?? 0) > 0,
      booking: {
        id: booking.id,
        bookingRef: booking.bookingRef,
        productId: booking.productId,
        quantity: booking.quantity,
        startDate: booking.startDate,
        endDate: booking.endDate,
        pickupConvenienceFee: booking.pickupConvenienceFee ?? 0,
        fulfillmentMethod: booking.fulfillmentMethod,
        location: booking.location ?? null,
        cityMunicipality: booking.cityMunicipality ?? null,
        province: booking.province ?? null,
        totalAmount: booking.totalAmount,
        customerSnapshot: booking.customerSnapshot,
      },
    });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Booking resume failed", error);
    return errorResponse("This reservation could not be resumed. Please try again.", 500);
  }
}
