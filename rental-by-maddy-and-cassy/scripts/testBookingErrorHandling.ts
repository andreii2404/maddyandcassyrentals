import assert from "node:assert/strict";
import test from "node:test";
import { submitBookingWithDateGuard } from "../src/services/inventoryService";

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
