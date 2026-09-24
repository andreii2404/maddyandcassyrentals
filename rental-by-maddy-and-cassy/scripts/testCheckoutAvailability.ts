import assert from "node:assert/strict";
import test from "node:test";
import { createBatchAvailabilityRequestKey } from "../src/lib/checkoutAvailability";
import { getTimeAvailabilityRpcArgs } from "../src/services/availabilityService";

test("availability request identity includes the selected time, rental days, quantity, and variant", () => {
  const key = createBatchAvailabilityRequestKey(
    [
      { productId: "camera", quantity: 1, variant: "Black" },
      { productId: "light", quantity: 2 },
    ],
    new Date("2026-10-12T04:30:00.000Z"),
    3,
  );

  assert.equal(
    key,
    '["2026-10-12T04:30:00.000Z",3,[["camera",1,"Black"],["light",2,""]]]',
  );
});

test("availability RPC always receives an explicit variant so PostgREST selects one function", () => {
  assert.deepEqual(
    getTimeAvailabilityRpcArgs(
      "product-1",
      new Date("2026-09-27T07:00:00.000Z"),
      1,
      1,
    ),
    {
      p_product_id: "product-1",
      p_pickup_at: "2026-09-27T07:00:00.000Z",
      p_quantity: 1,
      p_rental_days: 1,
      p_variant: null,
    },
  );
});
