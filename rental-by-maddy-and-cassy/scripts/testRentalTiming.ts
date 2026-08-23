import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateNextAvailableDateTime,
  calculateReturnDateTime,
  combineManilaPickupDateTime,
  createPickupTimeValue,
  isOutsideNormalPickupWindow,
  pickupTimeParts,
} from "../src/lib/rentalTiming";

test("a 7:00 PM Manila pickup returns after 22 hours and is ready after 24 hours", () => {
  const pickup = combineManilaPickupDateTime("2026-08-11", "19:00");
  assert.equal(pickup.toISOString(), "2026-08-11T11:00:00.000Z");
  assert.equal(calculateReturnDateTime(pickup).toISOString(), "2026-08-12T09:00:00.000Z");
  assert.equal(calculateNextAvailableDateTime(pickup).toISOString(), "2026-08-12T11:00:00.000Z");
});

test("normal pickup window includes exactly 9:00 AM through 7:00 PM", () => {
  assert.equal(isOutsideNormalPickupWindow("08:59"), true);
  assert.equal(isOutsideNormalPickupWindow("09:00"), false);
  assert.equal(isOutsideNormalPickupWindow("19:00"), false);
  assert.equal(isOutsideNormalPickupWindow("19:01"), true);
});

test("pickup time selector converts between reliable stored and display values", () => {
  assert.equal(createPickupTimeValue("12", "00", "AM"), "00:00");
  assert.equal(createPickupTimeValue("12", "30", "PM"), "12:30");
  assert.equal(createPickupTimeValue("7", "15", "PM"), "19:15");
  assert.deepEqual(pickupTimeParts("19:15"), { hour: "7", minute: "15", period: "PM" });
  assert.equal(createPickupTimeValue("13", "00", "PM"), "");
});
