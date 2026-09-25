import type { Booking, BookingStatus } from "@/src/types/booking";
import { pickupDateKey } from "@/src/lib/rentalTiming";

/**
 * Statuses the admin calendar shows: bookings an admin has approved that are
 * still active. This matches how the public availability calendar treats
 * "approved/confirmed/ready_for_release/released" as admin-approved holds.
 * Pending, rejected, cancelled, draft and already-returned bookings are left out.
 */
export const CALENDAR_BOOKING_STATUSES: readonly BookingStatus[] = [
  "approved",
  "confirmed",
  "ready_for_release",
  "released",
];

/** Rentals are capped well below this; it only guards against bad data looping forever. */
const MAX_MARKED_DAYS = 62;

export type BookingDayRole = "pickup" | "return" | "pickup_and_return" | "ongoing";

export interface MonthCursor {
  year: number;
  /** 0-based, like Date#getMonth. */
  month: number;
}

export interface CalendarCell {
  /** "YYYY-MM-DD" */
  dateKey: string;
  day: number;
  inMonth: boolean;
}

export function isCalendarBooking(booking: Booking): boolean {
  return CALENDAR_BOOKING_STATUSES.includes(booking.status);
}

function toManilaDateKey(value: string | undefined | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return pickupDateKey(parsed);
}

function addDaysToKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Pickup and return day keys ("YYYY-MM-DD", Manila time); null when the start is unusable. */
function bookingRange(booking: Booking): { startKey: string; endKey: string } | null {
  const startKey = toManilaDateKey(booking.startDate);
  if (!startKey) return null;
  const rawEndKey = toManilaDateKey(booking.endDate);
  const endKey = rawEndKey && rawEndKey >= startKey ? rawEndKey : startKey;
  return { startKey, endKey };
}

/** Every calendar day (Manila time) from pickup through return, inclusive. */
export function bookingDateKeys(booking: Booking): string[] {
  const range = bookingRange(booking);
  if (!range) return [];
  const keys: string[] = [];
  for (
    let key = range.startKey;
    key <= range.endKey && keys.length < MAX_MARKED_DAYS;
    key = addDaysToKey(key, 1)
  ) {
    keys.push(key);
  }
  return keys;
}

/** Approved bookings grouped by each day they cover, earliest pickup first within a day. */
export function groupBookingsByDate(bookings: Booking[]): Map<string, Booking[]> {
  const grouped = new Map<string, Booking[]>();
  for (const booking of bookings) {
    if (!isCalendarBooking(booking)) continue;
    for (const key of bookingDateKeys(booking)) {
      const list = grouped.get(key);
      if (list) list.push(booking);
      else grouped.set(key, [booking]);
    }
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  }
  return grouped;
}

/** What this booking is doing on the given day, so the admin can scan the list quickly. */
export function bookingDayRole(booking: Booking, dateKey: string): BookingDayRole {
  const range = bookingRange(booking);
  if (!range) return "ongoing";
  if (range.startKey === range.endKey && range.startKey === dateKey) return "pickup_and_return";
  if (dateKey === range.startKey) return "pickup";
  if (dateKey === range.endKey) return "return";
  return "ongoing";
}

/** One day's piece of a booking's rental-range bar on the month grid. */
export interface DayRangeSegment {
  booking: Booking;
  /** Row the bar sits in; stays the same for every day of the booking within a week. */
  lane: number;
  /** The same booking is also on the previous / next cell of this week row, so the bar joins it. */
  continuesLeft: boolean;
  continuesRight: boolean;
}

/**
 * Lays out each booking as one connected bar across the days it covers, the way
 * a wall calendar draws a multi-day event. `dateKeys` are the grid's cells in
 * order (whole Sunday-first weeks); bars never join across a week break.
 * Within a week, earlier and longer rentals get the upper lanes, and a booking
 * keeps its lane on every day of that week so its bar lines up.
 */
export function layoutRangeSegments(
  dateKeys: string[],
  bookingsByDate: Map<string, Booking[]>,
): Map<string, DayRangeSegment[]> {
  const layout = new Map<string, DayRangeSegment[]>();

  for (let weekStart = 0; weekStart < dateKeys.length; weekStart += 7) {
    const week = dateKeys.slice(weekStart, weekStart + 7);
    const idsByDay = week.map(
      (key) => new Set((bookingsByDate.get(key) ?? []).map((booking) => booking.id)),
    );

    // First and last column each booking covers in this week.
    const spans = new Map<string, { booking: Booking; first: number; last: number }>();
    week.forEach((key, column) => {
      for (const booking of bookingsByDate.get(key) ?? []) {
        const span = spans.get(booking.id);
        if (span) span.last = column;
        else spans.set(booking.id, { booking, first: column, last: column });
      }
    });

    const ordered = [...spans.values()].sort(
      (a, b) =>
        a.first - b.first ||
        (b.last - b.first) - (a.last - a.first) ||
        new Date(a.booking.startDate).getTime() - new Date(b.booking.startDate).getTime() ||
        a.booking.id.localeCompare(b.booking.id),
    );

    // Last column used by each lane; a lane is free once its bar has ended.
    const laneEnds: number[] = [];
    const lanes = new Map<string, number>();
    for (const span of ordered) {
      let lane = laneEnds.findIndex((end) => end < span.first);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = span.last;
      lanes.set(span.booking.id, lane);
    }

    week.forEach((key, column) => {
      const segments = (bookingsByDate.get(key) ?? []).map((booking) => ({
        booking,
        lane: lanes.get(booking.id) ?? 0,
        continuesLeft: column > 0 && idsByDay[column - 1].has(booking.id),
        continuesRight: column < week.length - 1 && idsByDay[column + 1].has(booking.id),
      }));
      if (segments.length) layout.set(key, segments.sort((a, b) => a.lane - b.lane));
    });
  }

  return layout;
}

/** Whole Sunday-first weeks covering the month, including leading/trailing days from neighbouring months. */
export function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = first.getUTCDay();
  const total = Math.ceil((leading + daysInMonth) / 7) * 7;

  const cells: CalendarCell[] = [];
  for (let index = 0; index < total; index += 1) {
    const date = new Date(Date.UTC(year, month, 1 - leading + index));
    cells.push({
      dateKey: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
    });
  }
  return cells;
}

export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const shifted = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

/** Today's date key in Manila time. */
export function todayDateKey(): string {
  return pickupDateKey(new Date());
}

export function monthCursorFromKey(dateKey: string): MonthCursor {
  const [year, month] = dateKey.split("-").map(Number);
  return { year, month: month - 1 };
}
