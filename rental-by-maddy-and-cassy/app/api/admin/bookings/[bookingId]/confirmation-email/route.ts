import { NextResponse } from "next/server";
import { sendBookingApprovalEmail } from "@/src/lib/server/bookingApprovalEmail";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_SEND_ERROR = "The confirmation email could not be sent. Please try again.";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Admin "Resend Email": sends the Approval Confirmation email again for an approved booking. */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-confirmation-email", 10, 60_000);
    await requireActiveAdmin();
    const { bookingId } = await params;

    const outcome = await sendBookingApprovalEmail({
      bookingId,
      origin: new URL(request.url).origin,
      resend: true,
    });

    if (outcome.sent) return NextResponse.json({ success: true, emailedTo: outcome.emailedTo ?? "" });

    // Technical causes (missing provider keys, provider rejections) are logged by the
    // helper; the admin only ever sees a plain-language message.
    if (outcome.reason === "not_found") return errorResponse("The selected booking could not be found.", 404);
    if (outcome.reason === "not_approved") {
      return errorResponse("The confirmation email is available after the booking has been approved.", 409);
    }
    if (outcome.reason === "invalid_recipient") {
      return errorResponse("The customer does not have a valid email address on this booking.", 422);
    }
    return errorResponse(GENERIC_SEND_ERROR, 502);
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Admin booking confirmation email failed", error);
    return errorResponse(GENERIC_SEND_ERROR, 500);
  }
}
