import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { getBookingById } from "@/src/services/bookingService";
import {
  AUTO_REJECT_DECLINE_DETAILS,
  AUTO_REJECT_DECLINE_REASON,
  formatDeclineNote,
  PAYMENT_PROOF_SUBMITTED_STATUSES,
  shouldAutoRejectForMissingRequirements,
} from "@/src/lib/bookingManagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Rejects a pending booking whose customer reached the requirements step
 * without submitting any required documents. The eligibility check is
 * repeated here so the browser can never force a rejection; the booking record,
 * payments, and history are kept and the rejection goes through the same
 * admin_set_booking_status RPC as a manual decline.
 */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-auto-reject", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;

    const booking = await getBookingById(supabase, bookingId);
    if (!booking) return errorResponse("The selected booking no longer exists.", 404);

    const { data: submittedPayment, error: paymentError } = await supabase
      .from("booking_payment_submissions")
      .select("id")
      .eq("booking_id", bookingId)
      .in("status", [...PAYMENT_PROOF_SUBMITTED_STATUSES])
      .limit(1)
      .maybeSingle();
    if (paymentError) {
      console.error("Auto-reject payment lookup failed", paymentError);
      return errorResponse("The booking could not be checked. Please try again.", 500);
    }

    const eligible = shouldAutoRejectForMissingRequirements({
      status: booking.status,
      requirementsStatus: booking.requirementsStatus,
      paymentProofSubmitted: Boolean(submittedPayment),
    });
    if (!eligible) return NextResponse.json({ success: true, rejected: false, bookingId, status: booking.status });

    const { data, error } = await supabase.rpc("admin_set_booking_status", {
      p_booking_id: bookingId,
      p_new_status: "rejected",
      p_note: formatDeclineNote(AUTO_REJECT_DECLINE_REASON, AUTO_REJECT_DECLINE_DETAILS),
    });
    if (error || !data) {
      // Someone else moved the booking first -- nothing left to reject.
      if (error?.message.includes("INVALID_STATUS_TRANSITION")) {
        return NextResponse.json({ success: true, rejected: false, bookingId, status: booking.status });
      }
      console.error("Automatic booking rejection failed", error);
      return errorResponse("The booking could not be rejected automatically. Please try again.", 500);
    }

    return NextResponse.json({ success: true, rejected: true, bookingId, status: data.status });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Automatic booking rejection failed", error);
    return errorResponse("The booking could not be rejected automatically. Please try again.", 500);
  }
}
