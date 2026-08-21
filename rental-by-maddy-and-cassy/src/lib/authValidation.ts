export const PHONE_DIGIT_COUNT = 11;
export const PASSWORD_MIN_LENGTH = 8;
export const EARLIEST_BIRTH_DATE = "1900-01-01";
export const MINIMUM_AGE_YEARS = 18;
export const UNDERAGE_ERROR_MESSAGE = "You must be at least 18 years old to create an account.";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhoneInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, PHONE_DIGIT_COUNT);
}

export function isValidPhoneNumber(value: string): boolean {
  return new RegExp(`^\\d{${PHONE_DIGIT_COUNT}}$`).test(value.trim());
}

export function toDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getMaxBirthDateForAge(minimumAge: number, today: Date): string {
  const cutoff = new Date(today.getFullYear() - minimumAge, today.getMonth(), today.getDate());
  return toDateInputValue(cutoff);
}

export function getMaxBirthDate(today = new Date()): string {
  return getMaxBirthDateForAge(MINIMUM_AGE_YEARS, today);
}

export function isValidBirthDate(value: string, today = new Date()): boolean {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    return false;
  }

  return normalized >= EARLIEST_BIRTH_DATE && normalized <= toDateInputValue(today);
}

export function isAtLeastMinimumAge(value: string, today = new Date()): boolean {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  return normalized <= getMaxBirthDate(today);
}

export function getPasswordValidationErrors(value: string): string[] {
  const errors: string[] = [];
  if (value.length < PASSWORD_MIN_LENGTH) errors.push(`At least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[a-z]/.test(value)) errors.push("One lowercase letter");
  if (!/[A-Z]/.test(value)) errors.push("One uppercase letter");
  if (!/\d/.test(value)) errors.push("One number");
  return errors;
}

export function isStrongPassword(value: string): boolean {
  return getPasswordValidationErrors(value).length === 0;
}
