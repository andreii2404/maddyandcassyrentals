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
