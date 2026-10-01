/**
 * Browser event fired right after a guest checkout creates its booking row, so
 * always-mounted UI (the navbar's Track Guest Booking link) can update without
 * waiting for a route change.
 */
export const GUEST_BOOKING_CREATED_EVENT = "guest-booking-created";

export function notifyGuestBookingCreated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(GUEST_BOOKING_CREATED_EVENT));
}
