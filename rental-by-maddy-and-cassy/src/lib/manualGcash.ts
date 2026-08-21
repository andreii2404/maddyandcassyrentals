export const GCASH_REFERENCE_PATTERN = /^[A-Za-z0-9-]{8,24}$/;

export function normalizeGcashReference(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
}

export function isValidGcashReference(value: string): boolean {
  return GCASH_REFERENCE_PATTERN.test(value.trim());
}
