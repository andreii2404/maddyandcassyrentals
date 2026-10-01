import type { BookingStatus, FulfillmentMethod } from "@/src/types/booking";

/** Same format the guest recovery form, API, and database already enforce. */
export const BOOKING_REFERENCE_PATTERN = /^BK-[A-Z0-9]{6,20}$/;
export const BOOKING_REFERENCE_PLACEHOLDER = "BK-CFC07994EC";
export const BOOKING_REFERENCE_MAX_LENGTH = 23;

/** One message for malformed and unknown references, so a lookup reveals nothing else. */
export const BOOKING_REFERENCE_NOT_FOUND_MESSAGE =
  "Booking reference not found. Please check the reference and try again.";

/** Uppercases, trims, and drops inner spaces so pasted references still match. */
export function normalizeBookingReference(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidBookingReference(value: string): boolean {
  return BOOKING_REFERENCE_PATTERN.test(normalizeBookingReference(value));
}

export type TrackingStepState = "complete" | "current" | "upcoming" | "closed";

export interface TrackingStep {
  key: string;
  label: string;
  description: string;
  state: TrackingStepState;
  timestamp: string | null;
}

/**
 * "none" = nothing submitted yet, "in_review" = submitted or under review,
 * "verified" = at least one payment verified. Amounts and proofs never leave
 * the server.
 */
export type TrackingPaymentState = "none" | "in_review" | "verified";

export interface TrackingTimelineInput {
  status: BookingStatus;
  fulfillmentMethod: FulfillmentMethod;
  paymentState: TrackingPaymentState;
  createdAt: string;
  approvedAt: string | null;
  confirmedAt: string | null;
  readyForReleaseAt: string | null;
  releasedAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  rejectedAt: string | null;
}

/**
 * The public Track Booking result. It deliberately carries no customer name,
 * contact details, address, payment amounts or proofs, documents, or internal
 * booking ids.
 */
export interface PublicBookingTracking {
  bookingReference: string;
  status: BookingStatus;
  statusLabel: string;
  statusMessage: string;
  fulfillmentMethod: FulfillmentMethod;
  items: { name: string; variant: string | null; quantity: number }[];
  pickupAt: string;
  returnAt: string;
  updatedAt: string;
  steps: TrackingStep[];
  /** Direct link to the full booking, only when the caller already owns it. */
  detailsPath: string | null;
}

const ACTIVE_ORDER: BookingStatus[] = [
  "pending",
  "approved",
  "confirmed",
  "ready_for_release",
  "released",
  "returned",
];

function handoverWord(method: FulfillmentMethod): string {
  return method === "delivery" ? "delivery" : "pickup";
}

export function publicStatusLabel(status: BookingStatus, method: FulfillmentMethod): string {
  switch (status) {
    case "pending": return "Booking Received";
    case "approved": return "Approved";
    case "confirmed": return "Confirmed";
    case "ready_for_release": return method === "delivery" ? "Ready for Delivery" : "Ready for Pickup";
    case "released": return method === "delivery" ? "Released for Delivery" : "Released";
    case "returned": return "Returned";
    case "cancelled": return "Cancelled";
    case "rejected": return "Rejected";
    default: return "In Progress";
  }
}

export function publicStatusMessage(status: BookingStatus, method: FulfillmentMethod): string {
  const handover = handoverWord(method);
  switch (status) {
    case "pending": return "We received your booking and are reviewing it together with your payment.";
    case "approved": return "Your booking is approved. We're finishing payment verification and final checks.";
    case "confirmed": return `Your booking is confirmed. We'll let you know when it's ready for ${handover}.`;
    case "ready_for_release": return `Your rental is prepared and ready for ${handover}.`;
    case "released": return method === "delivery"
      ? "Your rental has been handed over for delivery. Please return it by the return deadline."
      : "Your rental has been released. Please return it by the return deadline.";
    case "returned": return "The rental was returned and this booking is complete. Thank you!";
    case "cancelled": return "This booking was cancelled and its reserved dates were released.";
    case "rejected": return "This booking request was not approved. Sign in or contact us for more details.";
    default: return "Your booking is being processed.";
  }
}

/**
 * Parcel-style timeline. Active bookings list every milestone with the first
 * unfinished one marked current. Cancelled or rejected bookings list only the
 * milestones actually reached, followed by the closing event.
 */
export function buildTrackingTimeline(input: TrackingTimelineInput): TrackingStep[] {
  const isClosed = input.status === "cancelled" || input.status === "rejected";
  const index = ACTIVE_ORDER.indexOf(input.status);
  const reached = (position: number, timestamp: string | null) =>
    isClosed ? Boolean(timestamp) : index >= position;
  const handover = handoverWord(input.fulfillmentMethod);
  const confirmed = reached(2, input.confirmedAt);
  const paymentVerified = input.paymentState === "verified" || confirmed;

  const steps: (Omit<TrackingStep, "state"> & { done: boolean })[] = [
    {
      key: "received",
      label: "Booking Received",
      description: "Your booking reference was created and your rental dates were reserved.",
      timestamp: input.createdAt,
      done: true,
    },
    {
      key: "payment",
      label: "Payment Verification",
      description: paymentVerified
        ? "Your payment has been verified."
        : input.paymentState === "in_review"
          ? "Your payment was received and is being verified."
          : "Waiting for your payment to be submitted and verified.",
      timestamp: null,
      done: paymentVerified,
    },
    {
      key: "confirmed",
      label: "Approved / Confirmed",
      description: confirmed
        ? "Your booking is approved and confirmed."
        : reached(1, input.approvedAt)
          ? "Approved. Final requirements are being completed before confirmation."
          : "We'll review and confirm your booking.",
      timestamp: confirmed ? input.confirmedAt ?? input.approvedAt : input.approvedAt,
      done: confirmed,
    },
    {
      key: "ready",
      label: "Ready for Release",
      description: `Your rental is prepared and ready for ${handover}.`,
      timestamp: input.readyForReleaseAt,
      done: reached(3, input.readyForReleaseAt),
    },
    {
      key: "released",
      label: "Released",
      description: input.fulfillmentMethod === "delivery"
        ? "Your rental was handed over for delivery."
        : "Your rental was picked up.",
      timestamp: input.releasedAt,
      done: reached(4, input.releasedAt),
    },
    {
      key: "returned",
      label: "Returned",
      description: "The rental was returned and the booking is complete.",
      timestamp: input.returnedAt,
      done: reached(5, input.returnedAt),
    },
  ];

  if (isClosed) {
    const result: TrackingStep[] = steps
      .filter((step) => step.done)
      .map((step): TrackingStep => ({
        key: step.key,
        label: step.label,
        description: step.description,
        state: "complete",
        timestamp: step.timestamp,
      }));
    result.push({
      key: "closed",
      label: input.status === "cancelled" ? "Cancelled" : "Rejected",
      description: input.status === "cancelled"
        ? "This booking was cancelled and its reserved dates were released."
        : "This booking request was not approved.",
      state: "closed",
      timestamp: input.status === "cancelled" ? input.cancelledAt : input.rejectedAt,
    });
    return result;
  }

  const currentIndex = steps.findIndex((step) => !step.done);
  return steps.map((step, position): TrackingStep => {
    const isCurrent = position === currentIndex;
    return {
      key: step.key,
      label: step.label,
      description: step.description,
      state: step.done ? "complete" : isCurrent ? "current" : "upcoming",
      // Milestones that haven't happened yet never show a time.
      timestamp: step.done || isCurrent ? step.timestamp : null,
    };
  });
}
