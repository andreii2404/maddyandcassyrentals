import type { Booking, BookingStatus } from "@/src/types/booking";

/**
 * True when a booking may be auto-confirmed right after a payment is verified,
 * without an administrator manually clicking "Confirm Booking". Mirrors the
 * gates the PATCH admin route enforces for a manual confirm: the booking must
 * already be approved, the agreement must be fully countersigned, and — when
 * a birthday discount applies — the birthday must have been verified against
 * an approved ID. A booking with an unverified birthday discount stays
 * approved until an administrator confirms it manually.
 */
export function canAutoConfirmAfterPayment(input: {
  bookingStatus: BookingStatus;
  agreementStatus: string;
  birthdayDiscountAmount: number;
  birthdayDiscountStatus: Booking["birthdayDiscountStatus"];
}): boolean {
  return (
    input.bookingStatus === "approved" &&
    input.agreementStatus === "completed" &&
    (input.birthdayDiscountAmount <= 0 || input.birthdayDiscountStatus === "verified")
  );
}
