import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEstimatedDeliveryDateTime,
  calculateNextAvailableDateTime,
  calculateReturnDateTime,
  combineManilaPickupDateTime,
  computeUnavailablePickupTimes,
  createPickupTimeValue,
  formatManilaDateTime,
  isOutsideNormalPickupWindow,
  pickupTimeParts,
} from "../src/lib/rentalTiming";

test("estimated delivery adds the 2-hour minimum transportation allowance, crossing midnight", () => {
  const handover = combineManilaPickupDateTime("2026-10-01", "23:00");
  const eta = calculateEstimatedDeliveryDateTime(handover);
  assert.equal(eta.toISOString(), "2026-10-01T17:00:00.000Z");
  assert.equal(formatManilaDateTime(eta), formatManilaDateTime(combineManilaPickupDateTime("2026-10-02", "01:00")));
});

test("a 3-day rental picked up at 9:00 AM returns 70 hours later at 7:00 AM", () => {
  const pickup = combineManilaPickupDateTime("2026-10-01", "09:00");
  assert.equal(
    calculateReturnDateTime(pickup, 3).getTime(),
    combineManilaPickupDateTime("2026-10-04", "07:00").getTime(),
  );
});

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

test("computeUnavailablePickupTimes blocks pickup times before the buffered next-available slot", () => {
  const dayStart = combineManilaPickupDateTime("2026-10-08", "00:00");
  const windows = [
    {
      unitId: "unit-1",
      // Previous rental returns 2026-10-08 09:00 Manila; +2h buffer opens 11:00,
      // matching the spec's own example.
      start: combineManilaPickupDateTime("2026-10-07", "12:00").toISOString(),
      end: combineManilaPickupDateTime("2026-10-08", "11:00").toISOString(),
    },
  ];
  const unavailable = computeUnavailablePickupTimes(dayStart, 1, 1, 1, windows);
  assert.equal(unavailable.has("09:00"), true);
  assert.equal(unavailable.has("10:55"), true);
  assert.equal(unavailable.has("11:00"), false);
  assert.equal(unavailable.has("12:00"), false);
});

test("computeUnavailablePickupTimes only blocks a slot once every unit is taken", () => {
  const dayStart = combineManilaPickupDateTime("2026-10-08", "00:00");
  const windows = [
    {
      unitId: "unit-1",
      start: combineManilaPickupDateTime("2026-10-08", "00:00").toISOString(),
      end: combineManilaPickupDateTime("2026-10-09", "00:00").toISOString(),
    },
  ];
  assert.equal(computeUnavailablePickupTimes(dayStart, 1, 1, 2, windows).has("09:00"), false);
  assert.equal(computeUnavailablePickupTimes(dayStart, 1, 2, 2, windows).has("09:00"), true);
});

test("computeUnavailablePickupTimes accounts for a candidate's own rental length crossing midnight", () => {
  const dayStart = combineManilaPickupDateTime("2026-10-08", "00:00");
  const windows = [
    {
      unitId: "unit-1",
      // A separate booking blocks only the morning of the *next* day.
      start: combineManilaPickupDateTime("2026-10-09", "06:00").toISOString(),
      end: combineManilaPickupDateTime("2026-10-09", "10:00").toISOString(),
    },
  ];
  // A 1-day (24h) rental picked up at 20:00 on the 8th returns 20:00 on the
  // 9th, so its window overlaps the 9th's 06:00-10:00 block.
  const unavailable = computeUnavailablePickupTimes(dayStart, 1, 1, 1, windows);
  assert.equal(unavailable.has("20:00"), true);
  // Picked up at 00:00, the same rental fully returns by 00:00 the next day
  // -- well before that block starts -- so it's unaffected.
  assert.equal(unavailable.has("00:00"), false);
});
