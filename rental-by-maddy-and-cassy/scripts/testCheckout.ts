import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { calculateReservationPricing } from "../src/lib/reservationPricing";
import { calculateReturnDateTime, calculateSameDayFee } from "../src/lib/rentalTiming";

const cartRentalDetailsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/reservation/StepCartRentalDetails.tsx"),
  "utf8",
);
const rentalDetailsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/reservation/StepRentalDetails.tsx"),
  "utf8",
);

test("cart checkout renders one continue action for rental details", () => {
  assert.equal((cartRentalDetailsSource.match(/<ReservationFooter/g) ?? []).length, 1);
  assert.equal((cartRentalDetailsSource.match(/className=\{styles\.summaryActions\}/g) ?? []).length, 0);
});

test("cart summary displays the shared perk discount and adjusted rental subtotal", () => {
  const summarySource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../components/reservation/CheckoutSummaryDetails.tsx"),
    "utf8",
  );

  assert.match(summarySource, /<dt>Discounts<\/dt>[\s\S]*pricing\.specialDiscountAmount/);
  assert.match(summarySource, /<dt>Rental subtotal<\/dt>[\s\S]*pricing\.rentalSubtotal/);
  assert.match(cartRentalDetailsSource, /Estimated total/);
  assert.match(cartRentalDetailsSource, /pricing\.finalAmount/);
});

test("single-rental checkout does not duplicate the continue action", () => {
  assert.equal((rentalDetailsSource.match(/className=\{styles\.summaryActions\}/g) ?? []).length, 0);
});

test("checkout totals include quantity, discount, and non-refundable deposit", () => {
  const pricing = calculateReservationPricing(
    { id: "product-1", name: "Test Product", listPricePerDay: 1_000, pricePerDay: 900, refundableDeposit: 500 },
    {
      quantity: 2,
      startDate: new Date("2026-08-10T01:00:00.000Z"),
      endDate: calculateReturnDateTime(new Date("2026-08-10T01:00:00.000Z"), 3),
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
    sameDayFee: 0,
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

test("checkout includes the server-enforced outside-hours convenience fee", () => {
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

test("same-day fee is charged when the rental starts on the booking's Manila day", () => {
  // 2026-10-03 14:00 Manila booking time.
  const bookedAt = new Date("2026-10-03T06:00:00.000Z");

  assert.equal(calculateSameDayFee(new Date("2026-10-03T01:00:00.000Z"), bookedAt), 100); // 09:00 Manila
  assert.equal(calculateSameDayFee(new Date("2026-10-03T15:30:00.000Z"), bookedAt), 100); // 23:30 Manila
});

test("same-day fee follows the Asia/Manila calendar day, not UTC", () => {
  // 2026-10-03 00:30 Manila == 2026-10-02 16:30 UTC.
  const bookedAt = new Date("2026-10-02T16:30:00.000Z");
  const startsLaterThatManilaDay = new Date("2026-10-03T10:00:00.000Z"); // 18:00 Manila, Oct 3
  const startsNextManilaDay = new Date("2026-10-03T16:30:00.000Z"); // 00:30 Manila, Oct 4

  assert.equal(calculateSameDayFee(startsLaterThatManilaDay, bookedAt), 100);
  assert.equal(calculateSameDayFee(startsNextManilaDay, bookedAt), 0);
});

test("advance bookings and missing dates never get the same-day fee", () => {
  const bookedAt = new Date("2026-10-03T06:00:00.000Z");

  assert.equal(calculateSameDayFee(new Date("2026-10-04T02:00:00.000Z"), bookedAt), 0);
  assert.equal(calculateSameDayFee(null, bookedAt), 0);
  assert.equal(calculateSameDayFee(new Date(Number.NaN), bookedAt), 0);
});

test("checkout adds the same-day fee as its own line, separate from the outside-hours fee", () => {
  const product = { id: "product-1", name: "Test Product", listPricePerDay: 1_000, pricePerDay: 1_000, refundableDeposit: 200 };
  const draft = {
    quantity: 1,
    startDate: new Date("2026-10-03T11:00:00.000Z"),
    endDate: new Date("2026-10-04T09:00:00.000Z"),
    customerInfo: { birthDate: "" },
  };

  const advance = calculateReservationPricing(product, { ...draft, sameDayFee: 0 });
  assert.equal(advance.sameDayFee, 0);
  assert.equal(advance.finalAmount, 1_200);

  const sameDay = calculateReservationPricing(product, { ...draft, sameDayFee: 100 });
  assert.equal(sameDay.sameDayFee, 100);
  assert.equal(sameDay.fees, 0);
  assert.equal(sameDay.finalAmount, 1_300);

  const both = calculateReservationPricing(product, { ...draft, pickupConvenienceFee: 100, sameDayFee: 100 });
  assert.equal(both.fees, 100);
  assert.equal(both.sameDayFee, 100);
  assert.equal(both.finalAmount, 1_400);
});

test("booking-in-advance notice and same-day line items are wired into the booking flow", () => {
  const read = (path: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), "utf8");
  const notice = read("../components/reservation/BookingAdvanceNotice.tsx");

  assert.match(notice, /To secure any rental, reservations must be made ahead of time\. Same-day bookings may be\s+accepted only if available and once all necessary requirements are fulfilled\./);
  assert.match(notice, /\+ ₱\{SAME_DAY_CONVENIENCE_FEE\} convenience fee for same-day rental\./);
  assert.match(rentalDetailsSource, /<BookingAdvanceNotice/);
  assert.match(cartRentalDetailsSource, /<BookingAdvanceNotice/);
  assert.match(rentalDetailsSource, /Same-day convenience fee/);
  assert.match(read("../components/reservation/CheckoutSummaryDetails.tsx"), /Same-day convenience fee/);
  assert.match(read("../components/reservation/StepPaymentSubmission.tsx"), /Same-day convenience fee/);
  assert.match(read("../components/reservation/StepCartPaymentSubmission.tsx"), /Same-day convenience fee/);
});

test("guest checkout never receives birthday or loyalty account perks", () => {
  const pricing = calculateReservationPricing(
    { id: "product-1", name: "Test Product", listPricePerDay: 1_000, pricePerDay: 1_000, refundableDeposit: 0 },
    {
      quantity: 1,
      startDate: new Date("2026-08-11T00:00:00.000Z"),
      endDate: new Date("2026-08-11T22:00:00.000Z"),
      customerInfo: { birthDate: "2000-08-24" },
    },
    { completedRentals: 10, loyaltyRewardUsed: false },
    true,
  );

  assert.equal(pricing.birthdayDiscountAmount, 0);
  assert.equal(pricing.loyaltyDiscountAmount, 0);
  assert.equal(pricing.finalAmount, 1_000);
});
