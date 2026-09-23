import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireActiveAdmin,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import type { TablesUpdate } from "@/src/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    enforceRateLimit(request, "admin-booking-fulfillment", 20, 60_000);
    const { user } = await requireActiveAdmin();
    const { bookingId } = await params;
    const body = (await request.json().catch(() => null)) as {
      method?: unknown;
      location?: unknown;
      cityMunicipality?: unknown;
      province?: unknown;
    } | null;
    const method = body?.method;
    if (method !== "pickup" && method !== "delivery") {
      return errorResponse("Choose pickup or delivery.", 400);
    }

    const location = clean(body?.location);
    const cityMunicipality = clean(body?.cityMunicipality);
    const province = clean(body?.province);
    if (method === "delivery" && (!location || !cityMunicipality || !province)) {
      return errorResponse("Enter the complete delivery address before saving delivery.", 400);
    }

    const admin = createAdminClient();
    const [
      { data: booking },
      { data: currentFulfillment },
      { data: agreement },
    ] = await Promise.all([
      admin.from("bookings").select("id, status, customer_id").eq("id", bookingId).maybeSingle(),
      admin.from("booking_fulfillments").select("*").eq("booking_id", bookingId).maybeSingle(),
      admin.from("booking_agreements").select("id, status").eq("booking_id", bookingId).maybeSingle(),
    ]);
    if (!booking || !currentFulfillment) return errorResponse("The selected booking could not be found.", 404);
    if (["confirmed", "ready_for_release", "released", "returned", "cancelled", "rejected"].includes(booking.status)) {
      return errorResponse("Pickup or delivery can no longer be changed after the booking is confirmed or closed.", 409);
    }
    if (agreement) {
      return errorResponse("Pickup or delivery cannot be changed after the rental agreement has been generated.", 409);
    }

    const update: TablesUpdate<"booking_fulfillments"> = method === "delivery"
      ? {
          method,
          address_line_1: location,
          city_municipality: cityMunicipality,
          province,
        }
      : {
          method,
          address_line_1: null,
          city_municipality: null,
          province: null,
          delivery_fee_snapshot: 0,
        };
    const { error: updateError } = await admin
      .from("booking_fulfillments")
      .update(update)
      .eq("booking_id", bookingId);
    if (updateError) throw new Error(updateError.message);

    const { error: auditError } = await admin.rpc("log_audit_event", {
      p_action: "booking.fulfillment_method_updated",
      p_entity_type: "booking_fulfillment",
      p_entity_id: bookingId,
      p_booking_id: bookingId,
      p_previous_values: {
        method: currentFulfillment.method,
        location: currentFulfillment.address_line_1,
        cityMunicipality: currentFulfillment.city_municipality,
        province: currentFulfillment.province,
      },
      p_new_values: {
        changedByUserId: user.id,
        method,
        location: method === "delivery" ? location : null,
        cityMunicipality: method === "delivery" ? cityMunicipality : null,
        province: method === "delivery" ? province : null,
      },
    });
    if (auditError) console.error("Fulfillment method audit log failed", { bookingId, error: auditError.message });

    return NextResponse.json({ success: true, method });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Admin fulfillment method update failed", error);
    return errorResponse("The pickup or delivery setting could not be saved. Please try again.", 500);
  }
}
