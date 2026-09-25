import { NextResponse } from "next/server";
import { cleanText, isUuid, parseIsoDate } from "@/src/lib/fulfillmentApiHelpers";
import { jsonError, routeFailureResponse, rpcErrorResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The charge could not be updated. Please try again.";

/** Marks a charge as paid, or voids it. Charges are never deleted. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookingId: string; chargeId: string }> },
) {
  try {
    enforceRateLimit(request, "admin-booking-charge-update", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId, chargeId } = await params;
    if (!isUuid(bookingId) || !isUuid(chargeId)) return jsonError("That charge could not be found.", 404);

    const { data: charge } = await supabase
      .from("booking_charges")
      .select("id")
      .eq("id", chargeId)
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (!charge) return jsonError("That charge could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (body?.action === "mark_paid") {
      const paidAt = parseIsoDate(body.paidAt);
      if (!paidAt) return jsonError("Enter a valid date and time.", 400);
      const { error } = await supabase.rpc("admin_mark_charge_paid", {
        p_charge_id: chargeId,
        p_method: typeof body.method === "string" ? body.method : "",
        p_paid_at: paidAt,
      });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin mark charge paid failed");
      return NextResponse.json({ success: true });
    }

    if (body?.action === "void") {
      const { error } = await supabase.rpc("admin_void_booking_charge", {
        p_charge_id: chargeId,
        p_reason: cleanText(body.reason, 500),
      });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin void charge failed");
      return NextResponse.json({ success: true });
    }

    return jsonError("Choose a valid charge action.", 400);
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin charge update failed");
  }
}
