import type { Booking, BookingStatus, FulfillmentMethod } from "@/src/types/booking";

export type BookingHistoryFilter = "all" | "ongoing" | "completed" | "cancelled";

const ONGOING_STATUSES = new Set<BookingStatus>([
  "draft",
  "pending",
  "approved",
  "confirmed",
  "ready_for_release",
  "released",
]);

const CANCELLED_STATUSES = new Set<BookingStatus>(["cancelled", "rejected"]);

export function getBookingHistoryGroup(status: BookingStatus): Exclude<BookingHistoryFilter, "all"> {
  if (ONGOING_STATUSES.has(status)) return "ongoing";
  if (status === "returned") return "completed";
  if (CANCELLED_STATUSES.has(status)) return "cancelled";
  return "ongoing";
}

export function bookingMatchesHistoryFilter(
  booking: Booking,
  filter: BookingHistoryFilter,
): boolean {
  return filter === "all" || getBookingHistoryGroup(booking.status) === filter;
}

export function getBookingStatusMessage(
  status: BookingStatus,
  fulfillmentMethod: FulfillmentMethod,
): string {
  const handover = fulfillmentMethod === "delivery" ? "delivery" : "pickup";
  const messages: Record<BookingStatus, string> = {
    draft: "Complete the remaining booking steps to submit this request.",
    pending: "Your request is being reviewed. You may still cancel it or edit safe details.",
    approved: "Your request is approved. Complete any remaining payment and verification steps.",
    confirmed: `Your booking is confirmed. We will update you when it is ready for ${handover}.`,
    ready_for_release: `Your rental is prepared and ready for ${handover}.`,
    released: fulfillmentMethod === "delivery"
      ? "Your rental has been handed over for delivery or received by you."
      : "Your rental has been released to you.",
    returned: "The rental was returned and this booking is complete.",
    cancelled: "This booking was cancelled and its reserved dates were released.",
    rejected: "This request was not approved. Open the details for the administrator note.",
  };
  return messages[status];
}

export function getFulfillmentProgressLabel(
  status: BookingStatus,
  fulfillmentMethod: FulfillmentMethod,
): string {
  if (status === "returned") return "Completed";
  if (status === "cancelled" || status === "rejected") return "Closed";
  if (status === "released") return fulfillmentMethod === "delivery" ? "Out for delivery / received" : "Picked up";
  if (status === "ready_for_release") return fulfillmentMethod === "delivery" ? "Ready for delivery" : "Ready for pickup";
  if (status === "confirmed") return "Preparing item";
  return fulfillmentMethod === "delivery" ? "Delivery pending" : "Pickup pending";
}

export function canCustomerCancelBooking(status: BookingStatus): boolean {
  return status === "pending" || status === "approved";
}

export function canCustomerEditBooking(booking: Booking, hasLockedProgress: boolean): boolean {
  return booking.status === "pending" && !hasLockedProgress;
}

export interface BookingMilestone {
  key: string;
  label: string;
  description: string;
  completed: boolean;
  current: boolean;
  timestamp?: string;
}

export function getBookingMilestones(booking: Booking): BookingMilestone[] {
  const isClosed = booking.status === "cancelled" || booking.status === "rejected";
  const order: BookingStatus[] = [
    "pending",
    "approved",
    "confirmed",
    "ready_for_release",
    "released",
    "returned",
  ];
  const currentIndex = order.indexOf(booking.status);
  const fulfillment = booking.fulfillmentMethod === "delivery" ? "delivery" : "pickup";

  const milestones: BookingMilestone[] = [
    {
      key: "submitted",
      label: "Request submitted",
      description: "Booking reference created and rental dates reserved.",
      completed: true,
      current: booking.status === "pending",
      timestamp: booking.createdAt,
    },
    {
      key: "approved",
      label: "Request approved",
      description: "The business reviewed and approved the rental request.",
      completed: currentIndex >= 1 && !isClosed,
      current: booking.status === "approved",
      timestamp: booking.approvedAt,
    },
    {
      key: "confirmed",
      label: "Booking confirmed",
      description: "Payment, documents, and agreement requirements are complete.",
      completed: currentIndex >= 2 && !isClosed,
      current: booking.status === "confirmed",
      timestamp: booking.confirmedAt,
    },
    {
      key: "ready",
      label: `Ready for ${fulfillment}`,
      description: `The rental item is prepared for ${fulfillment}.`,
      completed: currentIndex >= 3 && !isClosed,
      current: booking.status === "ready_for_release",
      timestamp: booking.readyForReleaseAt,
    },
    {
      key: "released",
      label: booking.fulfillmentMethod === "delivery" ? "Delivered / received" : "Released at pickup",
      description: "The rental item was handed over to the customer.",
      completed: currentIndex >= 4 && !isClosed,
      current: booking.status === "released",
      timestamp: booking.releasedAt,
    },
    {
      key: "completed",
      label: "Rental completed",
      description: "The item was returned and the booking was completed.",
      completed: booking.status === "returned",
      current: booking.status === "returned",
      timestamp: booking.returnedAt,
    },
  ];

  if (isClosed) {
    milestones.push({
      key: "closed",
      label: booking.status === "cancelled" ? "Booking cancelled" : "Request declined",
      description: booking.status === "cancelled"
        ? "The reserved dates were released."
        : "The request was closed by the business.",
      completed: true,
      current: true,
      timestamp: booking.cancelledAt ?? booking.rejectedAt,
    });
  }

  return milestones;
}
