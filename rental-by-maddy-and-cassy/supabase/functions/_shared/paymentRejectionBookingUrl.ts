const PRODUCTION_ORIGIN = "https://maddyandcassyrentals-nine.vercel.app";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function paymentRejectionBookingUrl(bookingId: string, isGuestCheckout: boolean): string {
  if (typeof bookingId !== "string" || !UUID_PATTERN.test(bookingId)) {
    throw new Error("A valid booking ID is required for the payment rejection email.");
  }

  return `${PRODUCTION_ORIGIN}/${isGuestCheckout ? "guest" : "account"}/bookings/${bookingId}`;
}
