import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/src/lib/supabase/database.types";
import type {
  AgreementStatus,
  Booking,
  FulfillmentMethod,
  RequirementsStatus,
} from "@/src/types/booking";
import type { RewardProgress } from "@/src/lib/promotions";

// public.bookings no longer carries product_snapshot / customer_snapshot /
// rental_start_date / rental_end_date / requirements_status directly — a
// Booking is now assembled by joining bookings with booking_items (+ its
// product/brand/category/images), booking_fulfillments, booking_agreements,
// booking_requirements, the booking_totals view, and a profiles snapshot for
// the customer. There is no more standalone sync mapBooking(row); every
// export below does the joins itself.

type BookingItemProductRow = Pick<Tables<"products">, "name" | "specifications"> & {
  brands: Pick<Tables<"brands">, "name"> | null;
  categories: Pick<Tables<"categories">, "name"> | null;
  product_images: Pick<Tables<"product_images">, "storage_path" | "is_primary" | "sort_order">[] | null;
};

type BookingItemRow = Pick<
  Tables<"booking_items">,
  | "id"
  | "product_id"
  | "product_name_snapshot"
  | "daily_rate_snapshot"
  | "deposit_per_unit_snapshot"
  | "quantity"
> & {
  products: BookingItemProductRow | null;
  unit_reservations: Pick<Tables<"unit_reservations">, "inventory_unit_id" | "status">[] | null;
};

type JoinedBookingRow = Tables<"bookings"> & {
  booking_items: BookingItemRow[] | null;
  booking_fulfillments: Tables<"booking_fulfillments"> | null;
  booking_agreements: Pick<Tables<"booking_agreements">, "status"> | null;
  booking_requirements: Pick<Tables<"booking_requirements">, "status">[] | null;
};

const BOOKING_SELECT = `
  *,
  booking_items(
    id, product_id, product_name_snapshot, daily_rate_snapshot, deposit_per_unit_snapshot, quantity,
    products(name, specifications, brands(name), categories(name), product_images(storage_path, is_primary, sort_order)),
    unit_reservations(inventory_unit_id, status)
  ),
  booking_fulfillments(*),
  booking_agreements(status),
  booking_requirements(status)
`;

const ACTIVE_RESERVATION_STATUSES = new Set(["tentative", "confirmed", "in_use"]);

/**
 * bookings.rental_period is a Postgres daterange, serialized as e.g.
 * "[2026-08-05,2026-08-10)" — the upper bound is exclusive, so the inclusive
 * last rental day is one day before it.
 */
function parseRentalPeriod(range: unknown): { startDate: string; endDate: string } {
  const raw = typeof range === "string" ? range : "";
  const match = raw.match(/^[[(]([^,]*),([^,)\]]*)[)\]]$/);
  if (!match) return { startDate: "", endDate: "" };
  const startDate = match[1].trim();
  const upper = new Date(`${match[2].trim()}T00:00:00Z`);
  if (Number.isNaN(upper.getTime())) return { startDate, endDate: startDate };
  upper.setUTCDate(upper.getUTCDate() - 1);
  return { startDate, endDate: upper.toISOString().slice(0, 10) };
}

function deriveRequirementsStatus(
  requirements: Pick<Tables<"booking_requirements">, "status">[],
): RequirementsStatus {
  if (!requirements.length) return "not_submitted";
  if (requirements.some((requirement) => requirement.status === "rejected")) return "rejected";
  if (requirements.some((requirement) => requirement.status === "pending_review")) return "pending_review";
  if (requirements.every((requirement) => requirement.status === "approved" || requirement.status === "waived")) {
    return "approved";
  }
  return "not_submitted";
}

function primaryProductImageUrl(
  supabase: SupabaseClient<Database>,
  images: Pick<Tables<"product_images">, "storage_path" | "is_primary" | "sort_order">[] | null | undefined,
): string {
  const sorted = [...(images ?? [])].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
  const first = sorted[0];
  if (!first) return "/images/product-placeholder.png";
  return supabase.storage.from("product-images").getPublicUrl(first.storage_path).data.publicUrl;
}

function assembleBooking(
  supabase: SupabaseClient<Database>,
  row: JoinedBookingRow,
  totals: Tables<"booking_totals"> | undefined,
  profile: Tables<"profiles"> | undefined,
): Booking {
  const item = row.booking_items?.[0];
  const fulfillment = row.booking_fulfillments;
  const { startDate, endDate } = parseRentalPeriod(row.rental_period);
  const quantity = item?.quantity ?? 1;

  const specifications = (item?.products?.specifications as Record<string, string>) ?? {};
  const included = specifications.included
    ? specifications.included.split(",").map((value) => value.trim()).filter(Boolean)
    : [];

  const inventoryUnitId =
    item?.unit_reservations?.find((reservation) => ACTIVE_RESERVATION_STATUSES.has(reservation.status))
      ?.inventory_unit_id ?? null;

  return {
    id: row.id,
    bookingRef: row.booking_reference,
    customerId: row.customer_id,
    productId: item?.product_id ?? "",
    inventoryUnitId,
    quantity,
    status: row.status,
    fulfillmentMethod: (fulfillment?.method ?? "pickup") as FulfillmentMethod,
    startDate,
    endDate,
    dayCount: totals?.rental_days ?? 0,
    dailyRate: item?.daily_rate_snapshot ?? 0,
    refundableDeposit: (item?.deposit_per_unit_snapshot ?? 0) * quantity,
    rentalSubtotal: totals?.rental_subtotal ?? 0,
    specialDiscountAmount: totals?.special_discount_total ?? 0,
    birthdayDiscountAmount: row.birthday_discount_amount,
    birthdayDiscountStatus: row.birthday_discount_status as Booking["birthdayDiscountStatus"],
    loyaltyCompletedRentalsSnapshot: row.loyalty_completed_rentals_snapshot,
    loyaltyDiscountAmount: row.loyalty_discount_amount,
    loyaltyDiscountStatus: row.loyalty_discount_status as Booking["loyaltyDiscountStatus"],
    birthDateSnapshot: row.birth_date_snapshot ?? undefined,
    deliveryFee: totals?.delivery_fee ?? fulfillment?.delivery_fee_snapshot ?? 0,
    totalAmount: totals?.total_amount ?? 0,
    location: fulfillment?.address_line_1 ?? undefined,
    cityMunicipality: fulfillment?.city_municipality ?? undefined,
    province: fulfillment?.province ?? undefined,
    customerNotes: row.customer_notes ?? undefined,
    adminNotes: row.admin_notes ?? undefined,
    productSnapshot: {
      name: item?.product_name_snapshot || item?.products?.name || "Rental item",
      brand: item?.products?.brands?.name ?? "",
      category: item?.products?.categories?.name ?? "",
      image: primaryProductImageUrl(supabase, item?.products?.product_images),
      pricePerDay: item?.daily_rate_snapshot ?? 0,
      currency: row.currency_code,
      included,
    },
    customerSnapshot: {
      fullName: profile?.display_name ?? "",
      email: profile?.contact_email ?? "",
      phone: profile?.phone_number ?? "",
      address: profile?.full_address ?? "",
      facebookLink: profile?.facebook_url ?? "",
      instagramLink: profile?.instagram_url ?? "",
    },
    requirementsStatus: deriveRequirementsStatus(row.booking_requirements ?? []),
    agreementStatus: (row.booking_agreements?.status ?? "not_created") as AgreementStatus,
    approvedAt: row.approved_at ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
    rejectedAt: row.rejected_at ?? undefined,
    readyForReleaseAt: row.ready_for_release_at ?? undefined,
    releasedAt: row.released_at ?? undefined,
    returnedAt: row.returned_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchTotalsByBookingId(
  supabase: SupabaseClient<Database>,
  bookingIds: string[],
): Promise<Map<string, Tables<"booking_totals">>> {
  if (!bookingIds.length) return new Map();
  const { data } = await supabase.from("booking_totals").select("*").in("booking_id", bookingIds);
  const map = new Map<string, Tables<"booking_totals">>();
  for (const row of data ?? []) {
    if (row.booking_id) map.set(row.booking_id, row);
  }
  return map;
}

async function fetchProfilesById(
  supabase: SupabaseClient<Database>,
  userIds: string[],
): Promise<Map<string, Tables<"profiles">>> {
  const uniqueIds = [...new Set(userIds)];
  if (!uniqueIds.length) return new Map();
  const { data } = await supabase.from("profiles").select("*").in("id", uniqueIds);
  return new Map((data ?? []).map((row) => [row.id, row]));
}

async function assembleBookings(
  supabase: SupabaseClient<Database>,
  rows: JoinedBookingRow[],
): Promise<Booking[]> {
  const [totalsById, profilesById] = await Promise.all([
    fetchTotalsByBookingId(supabase, rows.map((row) => row.id)),
    fetchProfilesById(supabase, rows.map((row) => row.customer_id)),
  ]);
  return rows.map((row) =>
    assembleBooking(supabase, row, totalsById.get(row.id), profilesById.get(row.customer_id)),
  );
}

export async function getBookingById(
  supabase: SupabaseClient<Database>,
  bookingId: string,
): Promise<Booking | null> {
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !data) return null;
  const [booking] = await assembleBookings(supabase, [data as unknown as JoinedBookingRow]);
  return booking ?? null;
}

export async function getBookingsForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Booking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("customer_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return assembleBookings(supabase, (data ?? []) as unknown as JoinedBookingRow[]);
}

export async function getCustomerRewardProgress(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<RewardProgress> {
  const { data, error } = await supabase
    .from("bookings")
    .select("status, loyalty_discount_amount, booking_reference")
    .eq("customer_id", userId);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const completedRentals = rows.filter((booking) => booking.status === "returned").length;
  const rewardBooking = rows.find(
    (booking) => booking.loyalty_discount_amount > 0 && booking.status !== "cancelled",
  );
  return {
    completedRentals,
    loyaltyRewardUsed: Boolean(rewardBooking),
    activeRewardBookingRef: rewardBooking?.booking_reference,
  };
}

/** Admin-only: RLS (bookings_admin_manage) reveals every booking to an active admin. */
export async function getAllBookings(supabase: SupabaseClient<Database>): Promise<Booking[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return assembleBookings(supabase, (data ?? []) as unknown as JoinedBookingRow[]);
}

/** Renter self-service cancellation, only while still pending/approved — see public.cancel_own_booking(). */
export async function cancelBookingAsCustomer(
  supabase: SupabaseClient<Database>,
  bookingId: string,
  note?: string,
): Promise<Booking> {
  const { data, error } = await supabase.rpc("cancel_own_booking", {
    p_booking_id: bookingId,
    p_note: note,
  });
  if (error || !data) {
    const message = error?.message ?? "";
    if (message.includes("BOOKING_NOT_CANCELLABLE")) {
      throw new Error("This booking can no longer be cancelled online. Please contact the business for assistance.");
    }
    throw new Error(message || "The booking could not be cancelled.");
  }

  const refreshed = await getBookingById(supabase, (data as Tables<"bookings">).id);
  if (!refreshed) throw new Error("The booking could not be reloaded after cancellation.");
  return refreshed;
}

export interface CustomerBookingDetailsUpdate {
  fulfillmentMethod: FulfillmentMethod;
  location?: string;
  cityMunicipality?: string;
  province?: string;
  customerNotes?: string;
}

/** Updates only safe fulfillment details on an unpaid, pending booking owned by the current user. */
export async function updateBookingDetailsAsCustomer(
  supabase: SupabaseClient<Database>,
  bookingId: string,
  input: CustomerBookingDetailsUpdate,
): Promise<Booking> {
  const { data, error } = await supabase.rpc("update_own_booking_details", {
    p_booking_id: bookingId,
    p_fulfillment_method: input.fulfillmentMethod,
    p_location: input.location,
    p_city_municipality: input.cityMunicipality,
    p_province: input.province,
    p_customer_notes: input.customerNotes,
  });

  if (error || !data) {
    const message = error?.message ?? "";
    if (message.includes("BOOKING_EDIT_LOCKED") || message.includes("BOOKING_NOT_EDITABLE")) {
      throw new Error("This booking can no longer be edited because payment or verification has already started.");
    }
    if (message.includes("INCOMPLETE_DELIVERY_ADDRESS")) {
      throw new Error("Enter the complete street/barangay, city or municipality, and province for delivery.");
    }
    throw new Error(message || "The booking details could not be updated.");
  }

  const refreshed = await getBookingById(supabase, data.id);
  if (!refreshed) throw new Error("The booking could not be reloaded after the update.");
  return refreshed;
}
