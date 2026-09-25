import { NextResponse } from "next/server";
import { cleanText, isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { getCompletionBlockers } from "@/src/lib/rentalFulfillment";
import { jsonError, routeFailureResponse, rpcErrorResponse } from "@/src/lib/server/adminRouteErrors";
import { loadCompletionInputs } from "@/src/lib/server/fulfillmentServer";
import { sendRentalCompletedEmail } from "@/src/lib/server/rentalCompletedEmail";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The rental could not be completed. Please try again.";

/**
 * Completes a rental. Safe to call again: an already completed booking is left as is, and the
 * Rental Completed email is only sent if it has not gone out yet. A failed email never undoes
 * the completion; the admin uses Resend Email.
 */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-complete", 10, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const note = cleanText(body?.note, 1000);

    const admin = createAdminClient();
    const inputs = await loadCompletionInputs(admin, bookingId);
    if (!inputs) return jsonError("The selected booking could not be found.", 404);

    const alreadyCompleted = inputs.status === "returned";
    if (!alreadyCompleted) {
      const blockers = getCompletionBlockers(inputs);
      if (blockers.length) {
        return NextResponse.json({ error: "This rental cannot be completed yet.", blockers }, { status: 409 });
      }
      const { error } = await supabase.rpc("admin_complete_rental", {
        p_booking_id: bookingId,
        p_note: note || undefined,
      });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin complete rental failed");
    }

    const { data: emailState } = await admin
      .from("bookings")
      .select("completion_email_sent_at")
      .eq("id", bookingId)
      .maybeSingle();

    let emailSent = Boolean(emailState?.completion_email_sent_at);
    if (!emailSent) {
      const outcome = await sendRentalCompletedEmail({ bookingId, origin: new URL(request.url).origin });
      emailSent = outcome.sent;
    }

    return NextResponse.json({ success: true, alreadyCompleted, emailSent });
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin complete rental failed");
  }
}
