import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/src/lib/supabase/database.types";
import { toJson } from "@/src/lib/supabase/types";
import type { UnitCounts } from "@/lib/availability";
import type {
  BookingCustomerSnapshot,
  BookingProductSnapshot,
  EmergencyContact,
  FulfillmentMethod,
} from "@/src/types/booking";
import { formatManilaDateTime, formatManilaPickupTime } from "@/src/lib/rentalTiming";

export class InsufficientUnitsError extends Error {
  constructor(productId: string) {
    super(`No available units left for product "${productId}".`);
    this.name = "InsufficientUnitsError";
  }
}

export class DatesUnavailableError extends Error {
  constructor(requestedPickup?: string, nextAvailableAt?: string) {
    const requested = requestedPickup ? formatManilaPickupTime(requestedPickup) : "That";
    const next = nextAvailableAt
      ? ` and will be available starting ${formatManilaDateTime(nextAvailableAt)}`
      : " at a later time";
    super(`${requested} pickup is unavailable. This unit is still assigned to a previous rental${next}.`);
    this.name = "DatesUnavailableError";
  }
}

/** Same as DatesUnavailableError, but names which cart line/product it was raised for. */
export class ItemDatesUnavailableError extends Error {
  constructor(public readonly productId: string, requestedPickup?: string, nextAvailableAt?: string) {
    const requested = requestedPickup ? formatManilaPickupTime(requestedPickup) : "That";
    const next = nextAvailableAt
      ? ` and will be available starting ${formatManilaDateTime(nextAvailableAt)}`
      : " at a later time";
    super(`${requested} pickup is unavailable for one of the selected items${next}.`);
    this.name = "ItemDatesUnavailableError";
  }
}

export class AccountSuspendedError extends Error {
  constructor() {
    super("Your account is suspended and cannot create new bookings.");
    this.name = "AccountSuspendedError";
  }
}

export class DeliveryAddressRequiredError extends Error {
  constructor() {
    super("Please provide a complete delivery address (street/barangay, city/municipality, and province).");
    this.name = "DeliveryAddressRequiredError";
  }
}

export interface SubmitBookingInput {
  productId: string;
  quantity?: number;
  pickupAt: string;
  rentalDays?: number;
  fulfillmentMethod: FulfillmentMethod;
  /** Street/barangay/landmark line. Required only when fulfillmentMethod is "delivery". */
  location?: string;
  /** Required only when fulfillmentMethod is "delivery". */
  cityMunicipality?: string;
  /** Required only when fulfillmentMethod is "delivery". */
  province?: string;
  customerNotes?: string;
  deliveryFee?: number;
  discountAmount?: number;
  productSnapshot: BookingProductSnapshot;
  customerSnapshot: BookingCustomerSnapshot;
  emergencyContact?: EmergencyContact;
}

export interface SubmitBookingResult {
  bookingId: string;
  bookingRef: string;
  assignedUnitId: string | null;
}

/**
 * Atomically reserves one physical unit and creates the booking by calling
 * public.create_booking() — a SECURITY DEFINER Postgres function that row-locks
 * candidate inventory_units and re-checks date-range conflicts against
 * public.bookings server-side (see the migration in
 * supabase/migrations/20260802000000_paymongo_audit_push_agreement_versions.sql).
 * This is the real guard; any client-side date-picker check is UX only.
 */
export async function submitBookingWithDateGuard(
  supabase: SupabaseClient<Database>,
  input: SubmitBookingInput,
): Promise<SubmitBookingResult> {
  const { data, error } = await supabase.rpc("create_multi_day_time_based_booking", {
    p_product_id: input.productId,
    p_quantity: input.quantity ?? 1,
    p_pickup_at: input.pickupAt,
    p_rental_days: input.rentalDays ?? 1,
    p_fulfillment_method: input.fulfillmentMethod,
    p_location: input.location ?? "",
    p_city_municipality: input.cityMunicipality ?? "",
    p_province: input.province ?? "",
    p_customer_notes: input.customerNotes ?? "",
    p_delivery_fee: input.deliveryFee ?? 0,
    p_discount_amount: input.discountAmount ?? 0,
    p_product_snapshot: toJson(input.productSnapshot),
    p_customer_snapshot: toJson(input.customerSnapshot),
    p_emergency_contact: input.emergencyContact
      ? {
          fullName: input.emergencyContact.fullName,
          relationship: input.emergencyContact.relationship,
          phoneNumber: input.emergencyContact.phoneNumber,
          address: input.emergencyContact.address ?? "",
        }
      : null,
  });

  if (error) {
    if (error.message.includes("NO_TIME_AVAILABILITY")) {
      const nextAvailableAt = error.message.match(/NO_TIME_AVAILABILITY:([^\n]+)/)?.[1]?.trim();
      throw new DatesUnavailableError(input.pickupAt, nextAvailableAt);
    }
    if (error.message.includes("NO_AVAILABILITY")) {
      throw new DatesUnavailableError(input.pickupAt);
    }
    if (error.message.includes("PRODUCT_NOT_AVAILABLE")) {
      throw new InsufficientUnitsError(input.productId);
    }
    if (error.message.includes("ACCOUNT_SUSPENDED")) throw new AccountSuspendedError();
    if (error.message.includes("DELIVERY_ADDRESS_REQUIRED")) throw new DeliveryAddressRequiredError();
    if (error.message.includes("INVALID_QUANTITY")) throw new Error("Choose a valid rental quantity.");
    if (error.message.includes("PICKUP_TIME_IN_PAST")) throw new Error("Choose a future pickup date and time.");
    if (error.message.includes("PICKUP_TIME_REQUIRED")) throw new Error("Choose a pickup date and time.");
    // Anything else is an unexpected server-side failure, not something the
    // customer caused or can fix by re-entering details -- never surface the
    // raw database error text on the booking/payment screens.
    console.error("submitBookingWithDateGuard: unexpected booking error", error);
    throw new Error("We couldn't save your reservation due to a server error. Please try again in a moment.");
  }

  const booking = data as Tables<"bookings">;
  return {
    bookingId: booking.id,
    bookingRef: booking.booking_reference,
    // Which physical unit was claimed lives in unit_reservations now, which
    // customers can't read directly (admin-only RLS) — no longer exposed here.
    assignedUnitId: null,
  };
}

export interface SubmitMultiItemBookingInput {
  items: { productId: string; quantity: number }[];
  pickupAt: string;
  rentalDays: number;
  fulfillmentMethod: FulfillmentMethod;
  /** Street/barangay/landmark line. Required only when fulfillmentMethod is "delivery". */
  location?: string;
  /** Required only when fulfillmentMethod is "delivery". */
  cityMunicipality?: string;
  /** Required only when fulfillmentMethod is "delivery". */
  province?: string;
  customerNotes?: string;
  customerSnapshot: BookingCustomerSnapshot;
  emergencyContact?: EmergencyContact;
}

/**
 * Same shape as submitBookingWithDateGuard, but for the cart's combined
 * checkout: one booking, one shared rental period, many products/quantities.
 * Calls public.create_multi_item_booking() — a SECURITY DEFINER Postgres
 * function that derives product name/price/discount/deposit from `products`
 * itself (the client sends only {productId, quantity} per line) and locks
 * each product's inventory_units individually, in one transaction.
 */
export async function submitMultiItemBookingWithDateGuard(
  supabase: SupabaseClient<Database>,
  input: SubmitMultiItemBookingInput,
): Promise<SubmitBookingResult> {
  const { data, error } = await supabase.rpc("create_multi_item_booking", {
    p_items: toJson(input.items.map((item) => ({ productId: item.productId, quantity: item.quantity }))),
    p_pickup_at: input.pickupAt,
    p_rental_days: input.rentalDays,
    p_fulfillment_method: input.fulfillmentMethod,
    p_location: input.fulfillmentMethod === "delivery" ? (input.location ?? "") : "",
    p_city_municipality: input.fulfillmentMethod === "delivery" ? (input.cityMunicipality ?? "") : "",
    p_province: input.fulfillmentMethod === "delivery" ? (input.province ?? "") : "",
    p_customer_notes: input.customerNotes ?? "",
    p_delivery_fee: 0,
    p_customer_snapshot: toJson(input.customerSnapshot),
    p_emergency_contact: input.emergencyContact
      ? {
          fullName: input.emergencyContact.fullName,
          relationship: input.emergencyContact.relationship,
          phoneNumber: input.emergencyContact.phoneNumber,
          address: input.emergencyContact.address ?? "",
        }
      : null,
  });

  if (error) {
    const timeMatch = error.message.match(/NO_TIME_AVAILABILITY:([0-9a-fA-F-]{36}):([^\n]*)/);
    if (timeMatch) {
      const [, productId, nextAvailableAt] = timeMatch;
      throw new ItemDatesUnavailableError(productId, input.pickupAt, nextAvailableAt.trim() || undefined);
    }
    if (error.message.includes("NO_TIME_AVAILABILITY")) {
      throw new DatesUnavailableError(input.pickupAt);
    }
    if (error.message.includes("PRODUCT_NOT_AVAILABLE")) {
      throw new Error("One of the selected items is no longer available.");
    }
    if (error.message.includes("DUPLICATE_PRODUCT_ITEMS")) {
      throw new Error("Each item in your cart must be a distinct product.");
    }
    if (error.message.includes("ACCOUNT_SUSPENDED")) throw new AccountSuspendedError();
    if (error.message.includes("DELIVERY_ADDRESS_REQUIRED")) throw new DeliveryAddressRequiredError();
    if (error.message.includes("INVALID_QUANTITY")) throw new Error("Choose a valid rental quantity for every item.");
    if (error.message.includes("ITEMS_REQUIRED") || error.message.includes("TOO_MANY_ITEMS")) {
      throw new Error("Your cart has an invalid number of items.");
    }
    if (error.message.includes("PICKUP_TIME_IN_PAST")) throw new Error("Choose a future pickup date and time.");
    if (error.message.includes("PICKUP_TIME_REQUIRED")) throw new Error("Choose a pickup date and time.");
    console.error("submitMultiItemBookingWithDateGuard: unexpected booking error", error);
    throw new Error("We couldn't save your reservation due to a server error. Please try again in a moment.");
  }

  const booking = data as Tables<"bookings">;
  return {
    bookingId: booking.id,
    bookingRef: booking.booking_reference,
    assignedUnitId: null,
  };
}

/**
 * total_units from get_product_availability() is date-independent (just the
 * count of active inventory_units), so it's used for both totalUnits and
 * availableUnits here: catalog-wide displays represent whether the product has
 * rentable inventory at all, not whether a reservation happens to overlap
 * today. Real per-date availability is checked separately once the customer
 * picks rental dates (see useProductAvailability / availabilityService).
 */
async function fetchUnitCounts(
  supabase: SupabaseClient<Database>,
  productId: string,
): Promise<UnitCounts> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("get_product_availability", {
    p_product_id: productId,
    p_start_date: today,
    p_end_date: today,
  });
  if (error) throw new Error(error.message);
  const totalUnits = data?.[0]?.total_units ?? 0;
  return {
    totalUnits,
    availableUnits: totalUnits,
    reservedUnits: 0,
    rentedUnits: 0,
  };
}

const INVENTORY_POLL_INTERVAL_MS = 30_000;

/**
 * Customers can't SELECT inventory_units/unit_reservations directly (admin-only
 * RLS), so there's no table left to run postgres_changes realtime against.
 * This polls the same get_product_availability() RPC the catalog/booking flow
 * already uses instead of a live subscription.
 */
export function subscribeToInventory(
  supabase: SupabaseClient<Database>,
  productId: string,
  callback: (units: UnitCounts | null) => void,
): () => void {
  let cancelled = false;

  async function refresh() {
    try {
      const units = await fetchUnitCounts(supabase, productId);
      if (!cancelled) callback(units);
    } catch {
      if (!cancelled) callback(null);
    }
  }

  refresh();
  const intervalId = setInterval(refresh, INVENTORY_POLL_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(intervalId);
  };
}

export function subscribeToAllInventory(
  supabase: SupabaseClient<Database>,
  productIds: string[],
  callback: (unitsByProductId: Map<string, UnitCounts>) => void,
): () => void {
  let cancelled = false;

  async function refresh() {
    const entries = await Promise.all(
      productIds.map(async (productId) => {
        try {
          return [productId, await fetchUnitCounts(supabase, productId)] as const;
        } catch {
          return null;
        }
      }),
    );
    if (cancelled) return;
    const state = new Map<string, UnitCounts>();
    for (const entry of entries) {
      if (entry) state.set(entry[0], entry[1]);
    }
    callback(state);
  }

  refresh();
  const intervalId = productIds.length > 0 ? setInterval(refresh, INVENTORY_POLL_INTERVAL_MS) : null;

  return () => {
    cancelled = true;
    if (intervalId) clearInterval(intervalId);
  };
}
