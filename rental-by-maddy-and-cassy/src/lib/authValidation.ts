export const PHONE_DIGIT_COUNT = 11;
export const PASSWORD_MIN_LENGTH = 8;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhoneInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, PHONE_DIGIT_COUNT);
}

export function isValidPhoneNumber(value: string): boolean {
  return new RegExp(`^\\d{${PHONE_DIGIT_COUNT}}$`).test(value.trim());
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
