import { formatISO } from "date-fns";
import { createPublicClient } from "@/src/lib/supabase/public";

export const MAX_RENTAL_DAYS = 30;

export interface TimeAvailability {
  totalUnits: number;
  availableUnits: number;
  unavailableUnits: number;
  nextAvailableAt: string | null;
  pickupConvenienceFee: number;
}

export function toDateKey(date: Date): string {
  return formatISO(date, { representation: "date" });
}

/** How far ahead the reservation calendar pre-fetches fully-booked days. */
const CALENDAR_WINDOW_DAYS = 180;

/**
 * Date keys ("YYYY-MM-DD"), within the next CALENDAR_WINDOW_DAYS, on which
 * every active unit of a product is already held by a tentative/confirmed/
 * in_use reservation. Backed by the public.get_product_availability_calendar()
 * RPC — customers can't SELECT inventory_units/unit_reservations directly, so
 * this SECURITY DEFINER function is the only public source for calendar
 * greying. This is a non-atomic, UX-only read — the real guard is the
 * public.create_booking() RPC, which re-checks conflicts with row locks at
 * submission time.
 */
export async function getFullyBookedDateKeys(productId: string): Promise<Set<string>> {
  const supabase = createPublicClient();
  const today = new Date();
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + CALENDAR_WINDOW_DAYS);

  const { data, error } = await supabase.rpc("get_product_availability_calendar", {
    p_product_id: productId,
    p_start_date: toDateKey(today),
    p_end_date: toDateKey(windowEnd),
  });

  if (error) throw new Error(error.message);

  const fullyBooked = new Set<string>();
  for (const row of data ?? []) {
    if (row.total_units > 0 && row.available_units <= 0) fullyBooked.add(row.day);
  }
  return fullyBooked;
}

export async function isRangeAvailable(
  productId: string,
  startDate: Date,
  endDate: Date,
  requestedUnits = 1,
): Promise<boolean> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_product_availability", {
    p_product_id: productId,
    p_start_date: toDateKey(startDate),
    p_end_date: toDateKey(endDate),
  });

  if (error) throw new Error(error.message);
  return (data?.[0]?.available_units ?? 0) >= requestedUnits;
}

export async function getTimeAvailability(
  productId: string,
  pickupAt: Date,
  requestedUnits = 1,
  rentalDays = 1,
): Promise<TimeAvailability> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_product_multi_day_time_availability", {
    p_product_id: productId,
    p_pickup_at: pickupAt.toISOString(),
    p_quantity: requestedUnits,
    p_rental_days: rentalDays,
  });

  if (error) throw new Error(error.message);
  const row = data?.[0];
  return {
    totalUnits: Number(row?.total_units ?? 0),
    availableUnits: Number(row?.available_units ?? 0),
    unavailableUnits: Number(row?.unavailable_units ?? 0),
    nextAvailableAt: row?.next_available_at ?? null,
    pickupConvenienceFee: Number(row?.pickup_convenience_fee ?? 0),
  };
}

/**
 * Pre-flight, per-product availability check for every cart line against one
 * shared pickup time/rental-day window -- this is the "which item is
 * unavailable" UX check the multi-item checkout's rental-details step shows
 * before the customer can continue. Same technique as
 * inventoryService.subscribeToAllInventory(): Promise.all over the existing
 * single-product RPC, no new RPC needed. Not authoritative -- the
 * create_multi_item_booking RPC re-checks (and locks) at submission time.
 */
export async function checkBatchTimeAvailability(
  items: { productId: string; quantity: number }[],
  pickupAt: Date,
  rentalDays: number,
): Promise<Map<string, TimeAvailability>> {
  const entries = await Promise.all(
    items.map(async ({ productId, quantity }) => {
      try {
        return [productId, await getTimeAvailability(productId, pickupAt, quantity, rentalDays)] as const;
      } catch {
        return [productId, null] as const;
      }
    }),
  );
  const result = new Map<string, TimeAvailability>();
  for (const [productId, availability] of entries) {
    if (availability) result.set(productId, availability);
  }
  return result;
}
