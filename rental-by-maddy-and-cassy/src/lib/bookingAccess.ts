export function bookingTrackingPath(
  bookingId: string,
  isGuestCheckout: boolean,
  hash = "",
): string {
  const prefix = isGuestCheckout ? "/guest" : "/account";
  return `${prefix}/bookings/${encodeURIComponent(bookingId)}${hash}`;
}
