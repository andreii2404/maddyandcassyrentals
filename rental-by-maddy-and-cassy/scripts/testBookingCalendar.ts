import assert from "node:assert/strict";
import test from "node:test";
import type { Booking, BookingStatus } from "../src/types/booking";
import {
  bookingDateKeys,
  bookingDayRole,
  buildMonthGrid,
  groupBookingsByDate,
  isCalendarBooking,
  shiftMonth,
} from "../src/lib/bookingCalendar";

function makeBooking(overrides: Partial<Booking> & { id: string }): Booking {
  return {
    bookingRef: `REF-${overrides.id}`,
    status: "approved",
    startDate: "2026-08-11T01:00:00+00:00",
    endDate: "2026-08-12T01:00:00+00:00",
    ...overrides,
  } as Booking;
}

test("only admin-approved, still-active bookings appear on the calendar", () => {
  const shown: BookingStatus[] = ["approved", "confirmed", "ready_for_release", "released"];
  const hidden: BookingStatus[] = ["draft", "pending", "rejected", "cancelled", "returned"];
  for (const status of shown) assert.equal(isCalendarBooking(makeBooking({ id: "a", status })), true, status);
  for (const status of hidden) assert.equal(isCalendarBooking(makeBooking({ id: "a", status })), false, status);
});

test("a booking marks every day from pickup to return in Manila time", () => {
  // 2026-08-10 17:00 UTC is already 2026-08-11 01:00 in Manila.
  const booking = makeBooking({
    id: "a",
    startDate: "2026-08-10T17:00:00+00:00",
    endDate: "2026-08-13T09:00:00+00:00",
  });
  assert.deepEqual(bookingDateKeys(booking), [
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
  ]);
});

test("date-only legacy values and same-day rentals mark a single day", () => {
  assert.deepEqual(
    bookingDateKeys(makeBooking({ id: "a", startDate: "2026-08-05", endDate: "2026-08-05" })),
    ["2026-08-05"],
  );
});

test("missing or invalid dates never crash and mark nothing", () => {
  assert.deepEqual(bookingDateKeys(makeBooking({ id: "a", startDate: "", endDate: "" })), []);
  assert.deepEqual(bookingDateKeys(makeBooking({ id: "a", startDate: "nope", endDate: "nope" })), []);
});

test("an end date before the start date falls back to the start day", () => {
  assert.deepEqual(
    bookingDateKeys(makeBooking({
      id: "a",
      startDate: "2026-08-11T01:00:00+00:00",
      endDate: "2026-08-09T01:00:00+00:00",
    })),
    ["2026-08-11"],
  );
});

test("bookings are grouped per date, skipping non-approved ones, earliest pickup first", () => {
  const early = makeBooking({
    id: "early",
    startDate: "2026-08-11T00:00:00+00:00",
    endDate: "2026-08-12T00:00:00+00:00",
  });
  const late = makeBooking({
    id: "late",
    startDate: "2026-08-11T08:00:00+00:00",
    endDate: "2026-08-11T09:00:00+00:00",
    status: "released",
  });
  const pending = makeBooking({ id: "pending", status: "pending" });

  const grouped = groupBookingsByDate([late, pending, early]);
  assert.deepEqual(grouped.get("2026-08-11")?.map((b) => b.id), ["early", "late"]);
  assert.deepEqual(grouped.get("2026-08-12")?.map((b) => b.id), ["early"]);
  assert.equal(grouped.has("2026-08-10"), false);
});

test("each booking shows its role on the selected day", () => {
  const booking = makeBooking({
    id: "a",
    startDate: "2026-08-11T01:00:00+00:00",
    endDate: "2026-08-13T01:00:00+00:00",
  });
  assert.equal(bookingDayRole(booking, "2026-08-11"), "pickup");
  assert.equal(bookingDayRole(booking, "2026-08-12"), "ongoing");
  assert.equal(bookingDayRole(booking, "2026-08-13"), "return");
  const sameDay = makeBooking({
    id: "b",
    startDate: "2026-08-11T01:00:00+00:00",
    endDate: "2026-08-11T09:00:00+00:00",
  });
  assert.equal(bookingDayRole(sameDay, "2026-08-11"), "pickup_and_return");
});

test("month grid is whole Sunday-first weeks and flags days outside the month", () => {
  const grid = buildMonthGrid(2026, 7); // August 2026 (month is 0-based)
  assert.equal(grid.length % 7, 0);
  assert.equal(grid[0].dateKey, "2026-07-26"); // Aug 1 2026 is a Saturday
  assert.equal(grid[0].inMonth, false);
  const aug1 = grid.find((cell) => cell.dateKey === "2026-08-01");
  assert.equal(aug1?.inMonth, true);
  assert.equal(aug1?.day, 1);
  assert.equal(grid.at(-1)?.dateKey, "2026-09-05");
  assert.equal(grid.filter((cell) => cell.inMonth).length, 31);
});

test("shiftMonth rolls over year boundaries", () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 5 }, 1), { year: 2026, month: 6 });
});
