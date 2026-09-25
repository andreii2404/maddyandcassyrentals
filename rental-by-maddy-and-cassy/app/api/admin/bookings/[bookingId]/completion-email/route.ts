import { NextResponse } from "next/server";
import { isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { jsonError, routeFailureResponse } from "@/src/lib/server/adminRouteErrors";
import { sendRentalCompletedEmail } from "@/src/lib/server/rentalCompletedEmail";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The completion email could not be sent. Please try again.";

/** Admin "Resend Email" for a completed rental. */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-completion-email", 10, 60_000);
    await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const outcome = await sendRentalCompletedEmail({
      bookingId,
      origin: new URL(request.url).origin,
      resend: true,
    });
    if (outcome.sent) return NextResponse.json({ success: true, emailedTo: outcome.emailedTo ?? "" });

    if (outcome.reason === "not_found") return jsonError("The selected booking could not be found.", 404);
    if (outcome.reason === "not_completed") {
      return jsonError("The completion email is available after the rental is completed.", 409);
    }
    if (outcome.reason === "invalid_recipient") {
      return jsonError("The customer does not have a valid email address on this booking.", 422);
    }
    return jsonError(FAILURE, 502);
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin completion email failed");
  }
}
