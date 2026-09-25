import { NextResponse } from "next/server";
import { cleanText, isUuid, parseIsoDate } from "@/src/lib/fulfillmentApiHelpers";
import { jsonError, routeFailureResponse, rpcErrorResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The update could not be saved. Please try again.";

/** Records pickup, return, or item condition for a booking. */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-fulfillment", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const notes = cleanText(body?.notes, 1000);

    if (body?.action === "pickup" || body?.action === "return") {
      const at = parseIsoDate(body.at);
      if (!at) return jsonError("Enter a valid date and time.", 400);
      const { error } =
        body.action === "pickup"
          ? await supabase.rpc("admin_record_pickup", {
              p_booking_id: bookingId,
              p_picked_up_at: at,
              p_notes: notes || undefined,
            })
          : await supabase.rpc("admin_record_return", {
              p_booking_id: bookingId,
              p_returned_at: at,
              p_notes: notes || undefined,
            });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin pickup/return update failed");
      return NextResponse.json({ success: true });
    }

    if (body?.action === "condition") {
      if (body.condition !== "good" && body.condition !== "damaged") {
        return jsonError("Choose Good Condition or Has Damage.", 400);
      }
      const photoPaths = Array.isArray(body.photoPaths)
        ? body.photoPaths.filter((path): path is string => typeof path === "string")
        : [];
      const { error } = await supabase.rpc("admin_save_item_condition", {
        p_booking_id: bookingId,
        p_condition: body.condition,
        p_notes: notes || undefined,
        p_photo_paths: photoPaths,
      });
      if (error) return rpcErrorResponse(error, FAILURE, "Admin item condition update failed");
      return NextResponse.json({ success: true });
    }

    return jsonError("Choose a valid fulfillment action.", 400);
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin fulfillment update failed");
  }
}
