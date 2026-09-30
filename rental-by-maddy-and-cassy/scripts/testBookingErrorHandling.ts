import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Product } from "../types/product";
import { friendlyMessage } from "../src/lib/friendlyMessage";
import { createMultiItemBookingReservation } from "../src/services/bookingSubmissionService";
import { submitBookingWithDateGuard } from "../src/services/inventoryService";
import { createEmptyDraft } from "../src/types/reservationDraft";

test("submitBookingWithDateGuard logs Supabase error fields instead of an opaque object", async () => {
  const supabaseError = Object.create(null) as Record<string, string>;
  Object.defineProperties(supabaseError, {
    message: { value: "Could not choose the best candidate function between create_multi_day_time_based_booking overloads" },
    code: { value: "PGRST203" },
    details: { value: "Overloaded functions have the same best match" },
    hint: { value: "Drop the ambiguous overload or provide the missing argument" },
  });
  let rpcArgs: unknown[] | undefined;
  const supabase = {
    rpc: async (_name: string, args: unknown) => {
      rpcArgs = [args];
      return { data: null, error: supabaseError };
    },
  } as never;
  const originalConsoleError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => calls.push(args);

  try {
    await assert.rejects(
      submitBookingWithDateGuard(supabase, {
        productId: "product-id",
        pickupAt: "2026-10-01T02:00:00.000Z",
        fulfillmentMethod: "pickup",
        productSnapshot: {} as never,
        customerSnapshot: {} as never,
      }),
      /server error/,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.[0],
    'submitBookingWithDateGuard: booking RPC failed: {"message":"Could not choose the best candidate function between create_multi_day_time_based_booking overloads","code":"PGRST203","details":"Overloaded functions have the same best match","hint":"Drop the ambiguous overload or provide the missing argument"}',
  );
  assert.equal((rpcArgs?.[0] as { p_variant?: unknown }).p_variant, null);
});

test("submitBookingWithDateGuard logs known Supabase booking errors too", async () => {
  const supabase = {
    rpc: async () => ({
      data: null,
      error: {
        message: "NO_TIME_AVAILABILITY:2026-10-03T02:00:00.000Z",
        code: "P0001",
        details: "The requested pickup window is occupied",
        hint: "Choose another pickup time",
      },
    }),
  } as never;
  const originalConsoleError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => calls.push(args);

  try {
    await assert.rejects(
      submitBookingWithDateGuard(supabase, {
        productId: "product-id",
        pickupAt: "2026-10-01T02:00:00.000Z",
        fulfillmentMethod: "pickup",
        productSnapshot: {} as never,
        customerSnapshot: {} as never,
      }),
      /pickup is unavailable/,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(
    calls[0]?.[0],
    'submitBookingWithDateGuard: booking RPC failed: {"message":"NO_TIME_AVAILABILITY:2026-10-03T02:00:00.000Z","code":"P0001","details":"The requested pickup window is occupied","hint":"Choose another pickup time"}',
  );
});

const CAMERA_ID = "11111111-1111-4111-8111-111111111111";
const PHONE_ID = "22222222-2222-4222-8222-222222222222";

function cartProduct(id: string, name: string, colorOptions: string[]): Product {
  return { id, name, colorOptions } as unknown as Product;
}

function filledDraft() {
  const draft = createEmptyDraft();
  draft.startDate = new Date("2026-10-05T02:00:00.000Z");
  draft.endDate = new Date("2026-10-07T02:00:00.000Z");
  draft.fulfillmentMethod = "pickup";
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

async function submitCartWithRpcError(message: string | null) {
  let rpcArgs: { p_items?: { productId: string; variant?: string }[]; p_customer_notes?: string } | undefined;
  const supabase = {
    rpc: async (_name: string, args: typeof rpcArgs) => {
      rpcArgs = args;
      return message
        ? { data: null, error: { message, code: "P0001", details: null, hint: null } }
        : { data: { id: "booking-id", booking_reference: "MC-0001" }, error: null };
    },
  } as never;
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await createMultiItemBookingReservation(
      supabase,
      [
        // A stale color left on a product that has no color variants.
        { product: cartProduct(CAMERA_ID, "Canon G7X", []), quantity: 2, color: "Black" },
        { product: cartProduct(PHONE_ID, "iPhone 15", ["Black", "Blue"]), quantity: 1, color: "Blue" },
      ],
      filledDraft(),
    ).then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error: error as Error }),
    );
    return { ...result, rpcArgs };
  } finally {
    console.error = originalConsoleError;
  }
}

test("cart booking never sends a color for products without color variants", async () => {
  const { value, rpcArgs } = await submitCartWithRpcError(null);
  assert.equal(value?.bookingId, "booking-id");
  assert.deepEqual(rpcArgs?.p_items, [
    { productId: CAMERA_ID, quantity: 2 },
    { productId: PHONE_ID, quantity: 1, variant: "Blue" },
  ]);
  assert.equal(rpcArgs?.p_customer_notes, "Color choice — iPhone 15: Blue");
});

test("cart booking names the item and quantity when units run out", async () => {
  const { error } = await submitCartWithRpcError(`NO_VARIANT_AVAILABILITY:${CAMERA_ID}:`);
  assert.equal(
    error?.message,
    "Canon G7X doesn't have enough available units (2 units needed). Please lower the quantity or remove it from your cart.",
  );
  assert.doesNotMatch(error!.message, /color/i);
  assert.equal(friendlyMessage(error!.message, "error"), error!.message);
});

test("cart booking names the color only for multi-color products", async () => {
  const { error } = await submitCartWithRpcError(`NO_VARIANT_AVAILABILITY:${PHONE_ID}:Blue`);
  assert.equal(
    error?.message,
    "iPhone 15 (Blue) doesn't have enough available units (1 unit needed). Please lower the quantity or remove it from your cart.",
  );
});

test("cart booking names the item for a scheduling conflict", async () => {
  const { error } = await submitCartWithRpcError(`NO_TIME_AVAILABILITY:${CAMERA_ID}:`);
  assert.equal(
    error?.message,
    "Canon G7X isn't available for your selected pickup time (2 units needed). Please choose a different schedule.",
  );
});

test("cart booking RPC keeps the unscoped reservation for products without colors", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260930120000_fix_non_variant_cart_booking_wrapper.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /if not coalesce\(v_has_colors, false\) then\s+continue;/);
  assert.match(migration, /v_variant\s*:=\s*nullif\(trim\(v_variant\),\s*''\)/);
});
