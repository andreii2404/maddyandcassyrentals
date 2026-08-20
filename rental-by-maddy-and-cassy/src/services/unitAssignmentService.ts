import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";

export interface UnitAssignment {
  inventoryUnitId: string;
  unitCode: string;
  serialNumber: string | null;
  reservationStatus: string;
}

const ACTIVE_RESERVATION_STATUSES = new Set(["tentative", "confirmed", "in_use"]);

/**
 * The only way unit codes/serial numbers ever reach the client -- always read
 * from the real allocation rows via public.get_booking_unit_assignments()
 * (booking owner or admin only). Returns every row, active and historical
 * alike; callers deciding "is this fully allocated right now" must filter
 * with activeUnitAssignments()/assertUnitAssignmentsComplete() themselves.
 */
export async function getBookingUnitAssignments(
  supabase: SupabaseClient<Database>,
  bookingId: string,
): Promise<Map<string, UnitAssignment[]>> {
  const { data, error } = await supabase.rpc("get_booking_unit_assignments", {
    p_booking_id: bookingId,
  });
  if (error) throw new Error(error.message);

  const map = new Map<string, UnitAssignment[]>();
  for (const row of data ?? []) {
    const list = map.get(row.booking_item_id) ?? [];
    list.push({
      inventoryUnitId: row.inventory_unit_id,
      unitCode: row.unit_code,
      serialNumber: row.serial_number,
      reservationStatus: row.reservation_status,
    });
    map.set(row.booking_item_id, list);
  }
  return map;
}

export function activeUnitAssignments(assignments: UnitAssignment[] | undefined): UnitAssignment[] {
  return (assignments ?? []).filter((assignment) =>
    ACTIVE_RESERVATION_STATUSES.has(assignment.reservationStatus),
  );
}

export class IncompleteUnitAssignmentError extends Error {
  constructor(public readonly bookingItemId: string) {
    super(`Unit assignment for booking item "${bookingItemId}" is incomplete.`);
    this.name = "IncompleteUnitAssignmentError";
  }
}

/**
 * Every booking-creation RPC only ever returns a booking after locking
 * exactly `quantity` units per item (any shortfall rolls back the whole
 * transaction), so a freshly created booking is always fully allocated. This
 * is still verified explicitly before signing/finalizing an agreement --
 * never trust a placeholder, always confirm the real count. Only
 * active-status assignments count; a cancelled/completed row never does.
 */
export function assertUnitAssignmentsComplete(
  items: { bookingItemId: string; quantity: number }[],
  assignments: Map<string, UnitAssignment[]>,
): void {
  for (const item of items) {
    const activeCount = activeUnitAssignments(assignments.get(item.bookingItemId)).length;
    if (activeCount !== item.quantity) {
      throw new IncompleteUnitAssignmentError(item.bookingItemId);
    }
  }
}
