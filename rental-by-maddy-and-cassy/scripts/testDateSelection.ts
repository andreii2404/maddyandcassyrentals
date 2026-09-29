import assert from "node:assert/strict";
import test from "node:test";
import { selectRentalDateRange } from "../src/lib/rentalDateSelection";

const date = (value: string) => new Date(`${value}T00:00:00`);
const isDay = (value: string) => (day: Date) =>
  [day.getFullYear(), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0")]
    .join("-") === value;

test("clears a restored selected day even when that day is now unavailable", () => {
  const result = selectRentalDateRange({
    startDate: date("2026-09-30"),
    endDate: date("2026-09-30"),
    selectedDate: date("2026-09-30"),
    isDisabled: isDay("2026-09-30"),
  });

  assert.deepEqual(result, {
    range: { startDate: null, endDate: null },
    error: null,
  });
});

test("replaces a cleared saved day with a different available day", () => {
  const result = selectRentalDateRange({
    startDate: null,
    endDate: null,
    selectedDate: date("2026-10-02"),
    isDisabled: () => false,
  });

  assert.deepEqual(result, {
    range: { startDate: date("2026-10-02"), endDate: date("2026-10-02") },
    error: null,
  });
});

test("allows a saved range to move its end before an unavailable date", () => {
  const result = selectRentalDateRange({
    startDate: date("2026-09-28"),
    endDate: date("2026-10-02"),
    selectedDate: date("2026-09-29"),
    isDisabled: isDay("2026-09-30"),
  });

  assert.deepEqual(result, {
    range: { startDate: date("2026-09-28"), endDate: date("2026-09-29") },
    error: null,
  });
});

test("keeps availability validation when a changed end would include an unavailable date", () => {
  const result = selectRentalDateRange({
    startDate: date("2026-09-28"),
    endDate: date("2026-09-29"),
    selectedDate: date("2026-10-02"),
    isDisabled: isDay("2026-09-30"),
  });

  assert.deepEqual(result, {
    range: { startDate: date("2026-09-28"), endDate: date("2026-09-29") },
    error: "That range includes an unavailable date. Please choose another end date.",
  });
});
