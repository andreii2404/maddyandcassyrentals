import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

const ACTIVE_RESERVATION_STATUSES = ["tentative", "confirmed", "in_use"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ unitId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-inventory-unit", 60, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { unitId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const unitCode = typeof body.unitCode === "string" ? body.unitCode.trim().toUpperCase().slice(0, 80) : "";
    const serialNumber = typeof body.serialNumber === "string" ? body.serialNumber.trim().slice(0, 120) : "";
    const conditionNotes = typeof body.conditionNotes === "string" ? body.conditionNotes.trim().slice(0, 1000) : "";
    const acquiredAt = typeof body.acquiredAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.acquiredAt)
      ? body.acquiredAt
      : null;
    const lifecycleStatus = body.lifecycleStatus;
    if (!unitCode || !["active", "maintenance", "retired"].includes(String(lifecycleStatus))) {
      return NextResponse.json({ error: "Enter a valid unit code and lifecycle status." }, { status: 400 });
    }
    const nextLifecycleStatus = String(lifecycleStatus) as "active" | "maintenance" | "retired";

    const { data: existing, error: existingError } = await supabase
      .from("inventory_units")
      .select("id, lifecycle_status")
      .eq("id", unitId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) return NextResponse.json({ error: "The inventory unit no longer exists." }, { status: 404 });

    if (nextLifecycleStatus !== "active" && existing.lifecycle_status === "active") {
      const { data: reservation, error: reservationError } = await supabase
        .from("unit_reservations")
        .select("id")
        .eq("inventory_unit_id", unitId)
        .in("status", [...ACTIVE_RESERVATION_STATUSES])
        .limit(1)
        .maybeSingle();
      if (reservationError) throw new Error(reservationError.message);
      if (reservation) {
        return NextResponse.json(
          { error: "This unit has an active reservation and cannot be moved out of service." },
          { status: 409 },
        );
      }
    }

    const { error } = await supabase
      .from("inventory_units")
      .update({
        unit_code: unitCode,
        serial_number: serialNumber || null,
        lifecycle_status: nextLifecycleStatus,
        condition_notes: conditionNotes || null,
        acquired_at: acquiredAt,
        retired_at: nextLifecycleStatus === "retired" ? new Date().toISOString().slice(0, 10) : null,
      })
      .eq("id", unitId);
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Unit codes and serial numbers must be unique." }, { status: 409 });
      }
      throw new Error(error.message);
    }

    await supabase.rpc("log_audit_event", {
      p_action: "inventory.unit_updated",
      p_entity_type: "inventory_unit",
      p_entity_id: unitId,
      p_previous_values: { lifecycleStatus: existing.lifecycle_status },
      p_new_values: { lifecycleStatus: nextLifecycleStatus, unitCode },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Inventory unit update failed", error);
    return NextResponse.json({ error: "The inventory unit could not be updated." }, { status: 500 });
  }
}
