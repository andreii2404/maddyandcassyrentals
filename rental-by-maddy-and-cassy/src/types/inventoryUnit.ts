export type InventoryUnitLifecycleStatus = "active" | "maintenance" | "retired";

/**
 * public.inventory_units — one row per physical unit; the source of truth
 * for real-world counts. Never exposed to renters directly (admin-only RLS
 * read) — the get_product_availability()/get_product_availability_calendar()
 * RPCs are the public-facing, point-in-time computed snapshot (there is no
 * more materialized product_availability_summary table).
 */
export interface InventoryUnit {
  id: string;
  productId: string;
  unitCode: string;
  serialNumber?: string;
  lifecycleStatus: InventoryUnitLifecycleStatus;
  conditionNotes?: string;
  acquiredAt?: string;
  retiredAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** One day of public.get_product_availability_calendar()'s result set. */
export interface AvailabilityCalendarEntry {
  day: string;
  totalUnits: number;
  availableUnits: number;
  /** Of the blocked units, how many belong to an admin-approved/confirmed/released booking (vs. still pending review). */
  confirmedUnavailableUnits: number;
}

/** public.get_product_availability()'s result shape for a date range. */
export interface ProductAvailabilitySummary {
  productId: string;
  totalUnits: number;
  availableUnits: number;
  unavailableUnits: number;
}
