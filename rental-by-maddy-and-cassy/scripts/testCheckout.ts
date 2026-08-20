import assert from "node:assert/strict";
import test from "node:test";
import { calculateReservationPricing } from "../src/lib/reservationPricing";

test("checkout totals include quantity, discount, and non-refundable deposit", () => {
  const pricing = calculateReservationPricing(
    { id: "product-1", name: "Test Product", listPricePerDay: 1_000, pricePerDay: 900, refundableDeposit: 500 },
    {
      quantity: 2,
      startDate: new Date("2026-08-10T00:00:00"),
      endDate: new Date("2026-08-12T00:00:00"),
      customerInfo: { birthDate: "" },
    },
  );

  assert.deepEqual(pricing, {
    quantity: 2,
    rentalDays: 3,
    listSubtotal: 6_000,
    productSubtotal: 5_400,
    catalogDiscountAmount: 600,
    birthdayDiscountAmount: 0,
    loyaltyDiscountAmount: 0,
    specialDiscountAmount: 0,
    discountAmount: 600,
    rentalSubtotal: 5_400,
    depositAmount: 1_000,
    fees: 0,
    finalAmount: 6_400,
  });
});

test("checkout normalizes invalid quantities to one unit", () => {
  const pricing = calculateReservationPricing(
    { id: "product-1", name: "Test Product", listPricePerDay: 700, pricePerDay: 700, refundableDeposit: 0 },
    {
      quantity: 0,
      startDate: new Date("2026-08-10T00:00:00"),
      endDate: new Date("2026-08-10T00:00:00"),
      customerInfo: { birthDate: "" },
    },
  );

  assert.equal(pricing.quantity, 1);
  assert.equal(pricing.finalAmount, 700);
});

test("birthday and 11th-rental perks stack and are capped by the rental subtotal", () => {
  const pricing = calculateReservationPricing(
    { id: "product-1", name: "Test Product", listPricePerDay: 250, pricePerDay: 250, refundableDeposit: 0 },
    {
      quantity: 1,
      startDate: new Date("2026-08-10T00:00:00"),
      endDate: new Date("2026-08-10T00:00:00"),
      customerInfo: { birthDate: "2000-08-24" },
    },
    { completedRentals: 10, loyaltyRewardUsed: false },
  );

  assert.equal(pricing.birthdayDiscountAmount, 100);
  assert.equal(pricing.loyaltyDiscountAmount, 150);
  assert.equal(pricing.specialDiscountAmount, 250);
  assert.equal(pricing.finalAmount, 0);
});

test("checkout includes only the server-calculated pickup convenience fee", () => {
  const pricing = calculateReservationPricing(
    { id: "product-1", name: "Test Product", listPricePerDay: 1_000, pricePerDay: 1_000, refundableDeposit: 0 },
    {
      quantity: 1,
      startDate: new Date("2026-08-11T11:00:00.000Z"),
      endDate: new Date("2026-08-12T09:00:00.000Z"),
      pickupConvenienceFee: 100,
      customerInfo: { birthDate: "" },
    },
  );

  assert.equal(pricing.rentalDays, 1);
  assert.equal(pricing.fees, 100);
  assert.equal(pricing.finalAmount, 1_100);
});
