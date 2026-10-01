/** Same format the guest recovery form, API, and database already enforce. */
export const BOOKING_REFERENCE_PATTERN = /^BK-[A-Z0-9]{6,20}$/;
export const BOOKING_REFERENCE_PLACEHOLDER = "BK-CFC07994EC";
export const BOOKING_REFERENCE_MAX_LENGTH = 23;

export const BOOKING_LOOKUP_CODE_LENGTH = 6;
export const BOOKING_LOOKUP_CODE_PATTERN = /^\d{6}$/;
export const BOOKING_LOOKUP_CODE_MINUTES = 10;

/** Uppercases, trims, and drops inner spaces so pasted references still match. */
export function normalizeBookingReference(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidBookingReference(value: string): boolean {
  return BOOKING_REFERENCE_PATTERN.test(normalizeBookingReference(value));
}

export function normalizeLookupCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, BOOKING_LOOKUP_CODE_LENGTH);
}

/** Successful lookup / verification responses from /api/bookings/lookup. */
export type BookingLookupResult =
  | { status: "open"; path: string }
  | { status: "verify"; challengeId: string; expiresInMinutes: number }
  | { status: "sign_in"; path: string };
