import { NextResponse } from "next/server";
import { sendBookingApprovalEmail } from "@/src/lib/server/bookingApprovalEmail";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

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
    const { user } = await requireActiveAdmin();
    const { bookingId } = await params;

    const outcome = await sendBookingApprovalEmail({
      bookingId,
      origin: new URL(request.url).origin,
      resend: true,
    });

    if (outcome.sent) {
      const admin = createAdminClient();
      const { error: auditError } = await admin.rpc("log_audit_event", {
        p_action: "booking.confirmation_contract_emailed",
        p_entity_type: "booking",
        p_entity_id: bookingId,
        p_booking_id: bookingId,
        p_previous_values: {},
        p_new_values: {
          sentByUserId: user.id,
          emailedTo: outcome.emailedTo ?? "",
          providerId: outcome.providerId ?? null,
          attachment: outcome.contractFileName ?? null,
        },
      });
      if (auditError) {
        console.error("Confirmation email audit log failed", { bookingId, error: auditError.message });
      }
      return NextResponse.json({
        success: true,
        emailedTo: outcome.emailedTo ?? "",
        contractFileName: outcome.contractFileName ?? "",
      });
    }

    // Technical causes (missing provider keys, provider rejections) are logged by the
    // helper; the admin only ever sees a plain-language message.
    if (outcome.reason === "not_found") return errorResponse("The selected booking could not be found.", 404);
    if (outcome.reason === "not_approved") {
      return errorResponse("The confirmation email is available after the booking has been approved.", 409);
    }
    if (outcome.reason === "not_ready") {
      return errorResponse(
        "Approve the documents and payment, then add the business signature and generate the final contract before sending the confirmation email.",
        409,
      );
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
