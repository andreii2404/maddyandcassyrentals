import { NextResponse } from "next/server";
import { cleanText, isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { jsonError, routeFailureResponse, rpcErrorResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The charge could not be added. Please try again.";

/** Adds an extra charge. The admin types every amount; nothing is calculated automatically. */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-charge", 20, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const amount = typeof body?.amount === "number" ? body.amount : Number.NaN;
    if (!Number.isFinite(amount)) return jsonError("Enter an amount greater than zero.", 400);

    const { data, error } = await supabase.rpc("admin_add_booking_charge", {
      p_booking_id: bookingId,
      p_charge_type: typeof body?.chargeType === "string" ? body.chargeType : "",
      p_amount: amount,
      p_reason: cleanText(body?.reason, 500),
    });
    if (error || !data) return rpcErrorResponse(error, FAILURE, "Admin add charge failed");
    return NextResponse.json({ success: true, chargeId: data.id });
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin add charge failed");
  }
}
