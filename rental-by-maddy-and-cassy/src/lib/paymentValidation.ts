// Generic validation for the "Proof of Payment" fields. These accept GCash, Maya,
// or bank transfer details, so none of them assume a GCash-specific format.

export const PAYMENT_ACCOUNT_MIN_DIGITS = 4;
export const PAYMENT_ACCOUNT_MAX_DIGITS = 20;

export const ACCOUNT_NAME_MAX_LENGTH = 160;
const ACCOUNT_NAME_ALLOWED_CHARS = /[^\p{L} '-]/gu;
const ACCOUNT_NAME_PATTERN = /^\p{L}[\p{L} '-]*\p{L}$|^\p{L}$/u;

export const REFERENCE_NUMBER_MIN_LENGTH = 4;
export const REFERENCE_NUMBER_MAX_LENGTH = 120;
const REFERENCE_NUMBER_ALLOWED_CHARS = /[^A-Za-z0-9-]/g;
const REFERENCE_NUMBER_PATTERN = /^[A-Za-z0-9-]+$/;

/** Strips everything but digits, capped at the longest PH bank/e-wallet account length. */
export function normalizePaymentAccountInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, PAYMENT_ACCOUNT_MAX_DIGITS);
}

export function isValidPaymentAccountNumber(value: string): boolean {
  const trimmed = value.trim();
  return new RegExp(`^\\d{${PAYMENT_ACCOUNT_MIN_DIGITS},${PAYMENT_ACCOUNT_MAX_DIGITS}}$`).test(trimmed);
}

/** Strips digits and other disallowed characters as the user types. */
export function sanitizeAccountNameInput(value: string): string {
  return value.replace(ACCOUNT_NAME_ALLOWED_CHARS, "").slice(0, ACCOUNT_NAME_MAX_LENGTH);
}

export function isValidAccountName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= ACCOUNT_NAME_MAX_LENGTH && ACCOUNT_NAME_PATTERN.test(trimmed);
}

/** Strips spaces and other disallowed characters as the user types. */
export function sanitizeReferenceNumberInput(value: string): string {
  return value.replace(REFERENCE_NUMBER_ALLOWED_CHARS, "").slice(0, REFERENCE_NUMBER_MAX_LENGTH);
}

export function isValidReferenceNumber(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= REFERENCE_NUMBER_MIN_LENGTH &&
    trimmed.length <= REFERENCE_NUMBER_MAX_LENGTH &&
    REFERENCE_NUMBER_PATTERN.test(trimmed)
  );
}
