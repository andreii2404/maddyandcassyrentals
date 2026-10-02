import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Product } from "../types/product";
import {
  COURIER_OPTIONS,
  COURIER_RESPONSIBILITY_NOTE,
  EMPTY_COURIER_ARRANGEMENT,
  courierErrorMessage,
  formatCourier,
  formatReturnArrangement,
  getCourierArrangementIssues,
  isMissingRpcError,
  toCourierPayload,
  withCourierNote,
  type CourierArrangement,
} from "../src/lib/courierArrangement";
import { serializeReservationProgress, restoreReservationProgress } from "../src/lib/reservationProgress";
import {
  createBookingReservation,
  createMultiItemBookingReservation,
} from "../src/services/bookingSubmissionService";
import { updateBookingDetailsAsCustomer } from "../src/services/bookingService";
import { submitBookingWithDateGuard } from "../src/services/inventoryService";
import { createEmptyDraft, type ReservationDraft } from "../src/types/reservationDraft";

const LALAMOVE_BOTH_WAYS: CourierArrangement = {
  deliveryCourier: "lalamove",
  deliveryCourierOther: "",
  returnMethod: "courier",
  returnCourier: "lalamove",
  returnCourierOther: "",
};

test("delivery requires a courier and a return arrangement", () => {
  assert.deepEqual(getCourierArrangementIssues(EMPTY_COURIER_ARRANGEMENT), [
    "Choose the courier for your delivery.",
    "Choose how you will return the rental.",
  ]);
  assert.deepEqual(getCourierArrangementIssues(LALAMOVE_BOTH_WAYS), []);
  assert.deepEqual(
    getCourierArrangementIssues({ ...LALAMOVE_BOTH_WAYS, returnMethod: "dropoff", returnCourier: null }),
    [],
  );
  assert.deepEqual(getCourierArrangementIssues({ ...LALAMOVE_BOTH_WAYS, returnCourier: null }), [
    "Choose the courier for your return.",
  ]);
});

test("Other needs a courier name of at most 60 characters", () => {
  const other = { ...LALAMOVE_BOTH_WAYS, deliveryCourier: "other" as const, deliveryCourierOther: "   " };
  assert.deepEqual(getCourierArrangementIssues(other), ["Enter the name of your delivery courier."]);
  assert.deepEqual(getCourierArrangementIssues({ ...other, deliveryCourierOther: "Move It" }), []);
  assert.match(getCourierArrangementIssues({ ...other, deliveryCourierOther: "x".repeat(61) })[0], /60 characters/);
});

test("courier options are exactly Lalamove, Grab, Angkas, and Other", () => {
  assert.deepEqual(COURIER_OPTIONS.map((option) => option.label), ["Lalamove", "Grab", "Angkas", "Other"]);
  assert.equal(
    COURIER_RESPONSIBILITY_NOTE,
    "Courier booking and payment will be handled by the customer. Delivery fees are separate from the rental fee.",
  );
});

test("labels describe the delivery courier and the return", () => {
  assert.equal(formatCourier("grab"), "Grab");
  assert.equal(formatCourier("other", " Move It "), "Other — Move It");
  assert.equal(formatCourier(null), "");
  assert.equal(formatReturnArrangement({ returnMethod: "dropoff", returnCourier: null, returnCourierOther: "" }), "Return in person (Sta. Cruz, Manila)");
  assert.equal(formatReturnArrangement({ returnMethod: "courier", returnCourier: "angkas", returnCourierOther: "" }), "Courier — Angkas");
});

test("the RPC payload drops fields that do not apply", () => {
  assert.deepEqual(
    toCourierPayload({
      deliveryCourier: "grab",
      deliveryCourierOther: "stale name",
      returnMethod: "dropoff",
      returnCourier: "lalamove",
      returnCourierOther: "stale",
    }),
    { deliveryCourier: "grab", deliveryCourierOther: null, returnMethod: "dropoff", returnCourier: null, returnCourierOther: null },
  );
});

test("the fallback note replaces an earlier courier line instead of stacking", () => {
  const first = withCourierNote("Color choice — iPhone 15: Blue", LALAMOVE_BOTH_WAYS);
  assert.equal(
    first,
    "Color choice — iPhone 15: Blue\nCourier arrangement: delivery via Lalamove; return: Courier — Lalamove. Booked and paid by the customer.",
  );
  const second = withCourierNote(first, { ...LALAMOVE_BOTH_WAYS, deliveryCourier: "grab" });
  assert.equal(second.match(/Courier arrangement:/g)?.length, 1);
  assert.match(second, /delivery via Grab/);
});

test("missing RPCs and server courier errors are recognised", () => {
  assert.equal(isMissingRpcError({ code: "PGRST202", message: "x" }), true);
  assert.equal(isMissingRpcError({ code: "P0001", message: "Could not find the function public.create_booking_with_courier" }), true);
  assert.equal(isMissingRpcError({ code: "PGRST203", message: "ambiguous" }), false);
  assert.equal(isMissingRpcError(null), false);
  assert.match(courierErrorMessage("DELIVERY_COURIER_REQUIRED") ?? "", /Lalamove, Grab, Angkas/);
  assert.equal(courierErrorMessage("NO_AVAILABILITY"), null);
});

type RpcCall = { name: string; args: Record<string, unknown> };

function recordingSupabase(respond: (call: RpcCall) => { data: unknown; error: unknown }) {
  const calls: RpcCall[] = [];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      const call = { name, args };
      calls.push(call);
      return respond(call);
    },
  } as never;
  return { supabase, calls };
}

const BOOKING_ROW = { data: { id: "booking-id", booking_reference: "MC-0001" }, error: null };
const MISSING_RPC = { data: null, error: { code: "PGRST202", message: "Could not find the function", details: null, hint: null } };

function baseInput(fulfillmentMethod: "pickup" | "delivery") {
  return {
    productId: "product-id",
    pickupAt: "2026-10-05T02:00:00.000Z",
    fulfillmentMethod,
    productSnapshot: {} as never,
    customerSnapshot: {} as never,
  };
}

test("delivery bookings save the courier with a zero delivery fee", async () => {
  const { supabase, calls } = recordingSupabase(() => BOOKING_ROW);
  await submitBookingWithDateGuard(supabase, { ...baseInput("delivery"), deliveryFee: 500, courier: LALAMOVE_BOTH_WAYS });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "create_booking_with_courier");
  assert.equal("p_delivery_fee" in calls[0].args, false);
  assert.deepEqual(calls[0].args.p_courier, toCourierPayload(LALAMOVE_BOTH_WAYS));
});

test("pickup bookings keep using the existing booking RPC", async () => {
  const { supabase, calls } = recordingSupabase(() => BOOKING_ROW);
  await submitBookingWithDateGuard(supabase, baseInput("pickup"));
  assert.deepEqual(calls.map((call) => call.name), ["create_multi_day_time_based_booking"]);
  assert.equal("p_courier" in calls[0].args, false);
});

test("an unmigrated database still takes the booking and keeps the courier in notes", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { supabase, calls } = recordingSupabase((call) =>
      call.name === "create_booking_with_courier" ? MISSING_RPC : BOOKING_ROW,
    );
    const result = await submitBookingWithDateGuard(supabase, { ...baseInput("delivery"), courier: LALAMOVE_BOTH_WAYS });
    assert.equal(result.bookingId, "booking-id");
    assert.deepEqual(calls.map((call) => call.name), ["create_booking_with_courier", "create_multi_day_time_based_booking"]);
    assert.equal(calls[1].args.p_delivery_fee, 0);
    assert.match(String(calls[1].args.p_customer_notes), /^Courier arrangement: delivery via Lalamove/);
  } finally {
    console.warn = originalWarn;
  }
});

function deliveryDraft(courier: Partial<CourierArrangement> = LALAMOVE_BOTH_WAYS): ReservationDraft {
  const draft = createEmptyDraft();
  draft.startDate = new Date("2026-10-05T02:00:00.000Z");
  draft.endDate = new Date("2026-10-06T00:00:00.000Z");
  draft.fulfillmentMethod = "delivery";
  draft.customerLocation = "123 Street, Barangay 1";
  draft.cityMunicipality = "Manila";
  draft.province = "Metro Manila";
  Object.assign(draft, courier);
  draft.customerInfo = {
    ...draft.customerInfo,
    fullName: "Test Customer",
    email: "customer@example.com",
    phone: "09171234567",
    streetBarangay: "Street",
    cityMunicipality: "City",
    province: "Province",
    facebookLink: "https://facebook.com/test",
    instagramLink: "https://instagram.com/test",
  };
  return draft;
}

const PRODUCT = {
  id: "product-id",
  name: "Canon G7X",
  dailyRate: 500,
  discountPercent: 0,
  images: [],
  pricePerDay: 500,
  currency: "₱",
  included: [],
  category: "Cameras",
  colorOptions: [],
} as unknown as Product;

test("checkout refuses a delivery booking without a courier before calling the server", async () => {
  const { supabase, calls } = recordingSupabase(() => BOOKING_ROW);
  await assert.rejects(
    createBookingReservation(supabase, PRODUCT, deliveryDraft(EMPTY_COURIER_ARRANGEMENT)),
    /Choose the courier for your delivery/,
  );
  await assert.rejects(
    createMultiItemBookingReservation(supabase, [{ product: PRODUCT, quantity: 1 }], deliveryDraft({ ...LALAMOVE_BOTH_WAYS, returnMethod: null })),
    /Choose how you will return the rental/,
  );
  assert.equal(calls.length, 0);
});

test("cart delivery checkout sends the courier through the courier-aware RPC", async () => {
  const { supabase, calls } = recordingSupabase(() => BOOKING_ROW);
  await createMultiItemBookingReservation(supabase, [{ product: PRODUCT, quantity: 1 }], deliveryDraft({
    deliveryCourier: "other",
    deliveryCourierOther: "  Move It  ",
    returnMethod: "dropoff",
    returnCourier: null,
  }));
  assert.equal(calls[0].name, "create_multi_item_booking_with_courier");
  assert.equal("p_delivery_fee" in calls[0].args, false);
  assert.deepEqual(calls[0].args.p_courier, {
    deliveryCourier: "other",
    deliveryCourierOther: "Move It",
    returnMethod: "dropoff",
    returnCourier: null,
    returnCourierOther: null,
  });
});

test("editing a booking to delivery requires the courier before calling the server", async () => {
  const { supabase, calls } = recordingSupabase(() => BOOKING_ROW);
  await assert.rejects(
    updateBookingDetailsAsCustomer(supabase, "booking-id", {
      fulfillmentMethod: "delivery",
      location: "123 Street",
      cityMunicipality: "Manila",
      province: "Metro Manila",
    }),
    /Choose the courier for your delivery/,
  );
  assert.equal(calls.length, 0);
});

test("saved reservation progress keeps the courier for delivery only", () => {
  const raw = serializeReservationProgress({
    draft: deliveryDraft({ ...LALAMOVE_BOTH_WAYS, returnCourier: "grab" }),
    step: 2,
    bookingId: null,
    bookingNumber: null,
    paymentState: "unpaid",
    isDemoPayment: false,
  });
  const restored = restoreReservationProgress(raw);
  assert.equal(restored?.draft.deliveryCourier, "lalamove");
  assert.equal(restored?.draft.returnMethod, "courier");
  assert.equal(restored?.draft.returnCourier, "grab");

  const pickup = JSON.parse(raw);
  pickup.draft.fulfillmentMethod = "pickup";
  const restoredPickup = restoreReservationProgress(JSON.stringify(pickup));
  assert.equal(restoredPickup?.draft.deliveryCourier, null);
  assert.equal(restoredPickup?.draft.returnMethod, null);

  const tampered = JSON.parse(raw);
  tampered.draft.deliveryCourier = "jet-plane";
  assert.equal(restoreReservationProgress(JSON.stringify(tampered))?.draft.deliveryCourier, null);
});

test("the migration enforces the same couriers, a zero fee, and only grants signed-in users", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20261002140000_customer_arranged_courier.sql", import.meta.url),
    "utf8",
  );
  for (const option of COURIER_OPTIONS) assert.match(migration, new RegExp(`'${option.value}'`));
  assert.equal(migration.match(/p_delivery_fee => 0::numeric/g)?.length, 2);
  assert.match(migration, /between 1 and 60/);
  for (const fn of [
    "create_booking_with_courier",
    "create_multi_item_booking_with_courier",
    "update_own_booking_details_with_courier",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`));
  }
});
