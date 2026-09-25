export interface ApiError {
  message: string;
  status: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Returns a normalized ISO string for a plausible date, otherwise null. */
export function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return parsed.toISOString();
}

/** Trimmed string capped at maxLength. Anything that is not a string becomes "". */
export function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const RPC_ERRORS: [code: string, error: ApiError][] = [
  ["NOT_AUTHORIZED", { status: 403, message: "Active administrator access is required." }],
  ["BOOKING_NOT_FOUND", { status: 404, message: "The selected booking no longer exists." }],
  ["PICKUP_NOT_READY", { status: 409, message: "The booking must be Ready for Handover before pickup can be recorded." }],
  ["BALANCE_PAYMENT_REQUIRED", { status: 409, message: "The remaining balance must be settled before pickup can be confirmed." }],
  ["INVALID_STATUS_TRANSITION", { status: 409, message: "That action is not available for the booking's current status." }],
  ["RETURN_NOT_READY", { status: 409, message: "Record the pickup first, then the return." }],
  ["RETURN_BEFORE_PICKUP", { status: 400, message: "The return time cannot be earlier than the pickup time." }],
  ["CONDITION_NOT_READY", { status: 409, message: "The item condition can be recorded once the item has been picked up." }],
  ["INVALID_CONDITION", { status: 400, message: "Choose Good Condition or Has Damage." }],
  ["DAMAGE_NOTES_REQUIRED", { status: 400, message: "Describe the damage in the admin notes." }],
  ["TOO_MANY_PHOTOS", { status: 400, message: "You can attach up to 6 photos." }],
  ["INVALID_PHOTO_PATH", { status: 400, message: "One of the photos does not belong to this booking." }],
  ["INVALID_DATE", { status: 400, message: "Enter a valid date and time that is not in the future." }],
  ["CHARGE_NOT_ALLOWED", { status: 409, message: "Charges can be added once the booking is confirmed." }],
  ["INVALID_CHARGE_TYPE", { status: 400, message: "Choose Late Fee, Damage Fee or Other." }],
  ["INVALID_AMOUNT", { status: 400, message: "Enter an amount greater than zero." }],
  ["REASON_REQUIRED", { status: 400, message: "Add a short reason (at least 3 characters)." }],
  ["CHARGE_NOT_FOUND", { status: 404, message: "That charge no longer exists." }],
  ["CHARGE_VOIDED", { status: 409, message: "That charge has already been voided." }],
  ["CHARGE_ALREADY_PAID", { status: 409, message: "That charge is already marked as paid." }],
  ["INVALID_METHOD", { status: 400, message: "Choose Cash, GCash or Other." }],
  ["RENTAL_COMPLETED", { status: 409, message: "Charges can no longer be changed on a completed or closed booking." }],
  ["COMPLETION_BLOCKED", { status: 409, message: "This rental cannot be completed yet. Refresh the page and check the Complete Rental tab." }],
];

/** Maps a database error message (which contains one of our codes) to a friendly message. */
export function mapFulfillmentRpcError(message: string): ApiError | null {
  for (const [code, error] of RPC_ERRORS) {
    if (message.includes(code)) return error;
  }
  return null;
}
