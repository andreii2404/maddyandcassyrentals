export const RENTAL_DURATION_HOURS = 22;
export const TURNAROUND_HOURS = 2;
export const PICKUP_CONVENIENCE_FEE = 100;
export const DEFAULT_PICKUP_TIME = "09:00";

const MANILA_OFFSET = "+08:00";
const NORMAL_PICKUP_START_MINUTES = 9 * 60;
const NORMAL_PICKUP_END_MINUTES = 19 * 60;

export type PickupPeriod = "AM" | "PM";

export interface PickupTimeParts {
  hour: string;
  minute: string;
  period: PickupPeriod;
}

function minutesFromTime(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isValidPickupTime(value: string): boolean {
  return minutesFromTime(value) !== null;
}

export function pickupTimeParts(value: string): PickupTimeParts | null {
  const totalMinutes = minutesFromTime(value);
  if (totalMinutes === null) return null;
  const hour24 = Math.floor(totalMinutes / 60);
  return {
    hour: String(hour24 % 12 || 12),
    minute: String(totalMinutes % 60).padStart(2, "0"),
    period: hour24 >= 12 ? "PM" : "AM",
  };
}

export function createPickupTimeValue(
  hour: string,
  minute: string,
  period: PickupPeriod,
): string {
  const parsedHour = Number(hour);
  const parsedMinute = Number(minute);
  if (
    !Number.isInteger(parsedHour) ||
    parsedHour < 1 ||
    parsedHour > 12 ||
    !Number.isInteger(parsedMinute) ||
    parsedMinute < 0 ||
    parsedMinute > 59
  ) {
    return "";
  }
  const hour24 = (parsedHour % 12) + (period === "PM" ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${String(parsedMinute).padStart(2, "0")}`;
}

export function isOutsideNormalPickupWindow(value: string): boolean {
  const minutes = minutesFromTime(value);
  return minutes !== null && (
    minutes < NORMAL_PICKUP_START_MINUTES || minutes > NORMAL_PICKUP_END_MINUTES
  );
}

export function combineManilaPickupDateTime(dateKey: string, pickupTime: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !isValidPickupTime(pickupTime)) {
    return new Date(Number.NaN);
  }
  return new Date(`${dateKey}T${pickupTime}:00${MANILA_OFFSET}`);
}

export function calculateReturnDateTime(pickupAt: Date, rentalDays = 1): Date {
  const normalizedDays = Math.max(1, Math.trunc(rentalDays));
  const rentalHours = RENTAL_DURATION_HOURS + (normalizedDays - 1) * 24;
  return new Date(pickupAt.getTime() + rentalHours * 60 * 60 * 1000);
}

export function calculateNextAvailableDateTime(pickupAt: Date, rentalDays = 1): Date {
  return new Date(
    calculateReturnDateTime(pickupAt, rentalDays).getTime() + TURNAROUND_HOURS * 60 * 60 * 1000,
  );
}

export function formatManilaDateTime(value: Date | string): string {
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) return "a later time";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function formatManilaPickupTime(value: Date | string): string {
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) return "That";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function manilaTimeInputValue(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return hour && minute ? `${hour}:${minute}` : "";
}

export function pickupDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

/** Matches the 5-minute increments PickupTimeSelector already offers. */
const PICKUP_SLOT_MINUTES = 5;

export interface ReservedWindow {
  unitId: string;
  start: string;
  end: string;
}

/**
 * How many days ahead a reserved-windows fetch must span to cover every
 * candidate pickup time on the given day: the latest candidate (just before
 * midnight) still needs its own full rentalDays-long window.
 */
export function reservedWindowLookaheadDays(rentalDays: number): number {
  return Math.max(1, Math.trunc(rentalDays)) + 1;
}

/**
 * For every 5-minute pickup slot on the Manila calendar day starting at
 * `dayStart`, determines whether picking that time would leave fewer than
 * `quantity` units free for the whole rental period (22h + 2h buffer per
 * day, already baked into each reserved window's end). Returns the set of
 * blocked slots as "HH:MM" strings, matching PickupTimeSelector's value
 * format -- used to disable/hide already-occupied or buffer-blocked times
 * instead of only rejecting them after the customer picks one.
 */
export function computeUnavailablePickupTimes(
  dayStart: Date,
  rentalDays: number,
  quantity: number,
  totalUnits: number,
  windows: ReservedWindow[],
): Set<string> {
  const unavailable = new Set<string>();
  const normalizedDays = Math.max(1, Math.trunc(rentalDays));
  const rentalSpanMs = normalizedDays * 24 * 60 * 60 * 1000;
  const parsedWindows = windows
    .map((window) => ({
      unitId: window.unitId,
      start: new Date(window.start).getTime(),
      end: new Date(window.end).getTime(),
    }))
    .filter((window) => !Number.isNaN(window.start) && !Number.isNaN(window.end));
  const slotsPerDay = (24 * 60) / PICKUP_SLOT_MINUTES;

  for (let slot = 0; slot < slotsPerDay; slot += 1) {
    const pickupAt = new Date(dayStart.getTime() + slot * PICKUP_SLOT_MINUTES * 60 * 1000);
    const candidateEnd = pickupAt.getTime() + rentalSpanMs;
    const blockedUnitIds = new Set<string>();
    for (const window of parsedWindows) {
      if (window.start < candidateEnd && window.end > pickupAt.getTime()) {
        blockedUnitIds.add(window.unitId);
      }
    }
    const availableUnits = totalUnits - blockedUnitIds.size;
    if (availableUnits < quantity) {
      unavailable.add(manilaTimeInputValue(pickupAt));
    }
  }

  return unavailable;
}
