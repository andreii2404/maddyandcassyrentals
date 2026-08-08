import assert from "node:assert/strict";
import test from "node:test";
import { calculateReservationPricing } from "../src/lib/reservationPricing";

test("checkout totals include quantity, discount, and non-refundable deposit", () => {
  const pricing = calculateReservationPricing(
    { listPricePerDay: 1_000, pricePerDay: 900, refundableDeposit: 500 },
    {
      quantity: 2,
      startDate: new Date("2026-08-10T00:00:00"),
      endDate: new Date("2026-08-12T00:00:00"),
    },
  );

  assert.deepEqual(pricing, {
    quantity: 2,
    rentalDays: 3,
    listSubtotal: 6_000,
    productSubtotal: 5_400,
    discountAmount: 600,
    depositAmount: 1_000,
    fees: 0,
    finalAmount: 6_400,
  });
});

test("checkout normalizes invalid quantities to one unit", () => {
  const pricing = calculateReservationPricing(
    { listPricePerDay: 700, pricePerDay: 700, refundableDeposit: 0 },
    {
      quantity: 0,
      startDate: new Date("2026-08-10T00:00:00"),
      endDate: new Date("2026-08-10T00:00:00"),
    },
  );

  assert.equal(pricing.quantity, 1);
  assert.equal(pricing.finalAmount, 700);
});
