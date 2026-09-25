import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { bookingHeadline } from "@/src/lib/bookingDisplay";
import type { BookingStatusEmailDetails } from "@/src/lib/bookingStatusEmailContent";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import type { Booking } from "@/src/types/booking";

export interface ApprovalEmailPayment {
  declaredAmount: number;
  status: string;
}

interface ApprovalEmailInput {
  booking: Booking;
  payments: ApprovalEmailPayment[];
  /** Used only when the booking's own contact email is blank. */
  fallbackEmail?: string | null;
  origin: string;
  deliveryKey: string;
}

function formatDate(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: string): string {
  if (!value || Number.isNaN(new Date(value).getTime())) return "";
  return formatManilaDateTime(value);
}

function formatCurrency(value: number): string {
  return `PHP ${value.toLocaleString("en-PH")}`;
}

function formatStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Builds the Approval Confirmation email content for a booking. The recipient is the
 * email saved on the booking itself (which is where guest checkout stores the guest's
 * address), falling back to the account email only when that is blank.
 */
export function buildApprovalEmailDetails({
  booking,
  payments,
  fallbackEmail,
  origin,
  deliveryKey,
}: ApprovalEmailInput): BookingStatusEmailDetails {
  const amountPaid = payments
    .filter((payment) => payment.status === "verified")
    .reduce((sum, payment) => sum + payment.declaredAmount, 0);
  const remainingBalance = Math.max(0, booking.totalAmount - amountPaid);
  const paymentStatus = amountPaid <= 0
    ? "Unpaid"
    : remainingBalance > 0.01
      ? "Partially Paid"
      : "Paid";

  const remainingActions: string[] = [];
  if (remainingBalance > 0.01) {
    remainingActions.push("Pay the remaining balance before handover");
  }
  if (booking.requirementsStatus !== "approved") remainingActions.push("Complete your verification documents");
  if (booking.agreementStatus !== "completed") remainingActions.push("Complete the rental agreement");

  const location = [booking.location, booking.cityMunicipality, booking.province]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  const dayLabel = `${booking.dayCount} day${booking.dayCount === 1 ? "" : "s"}`;
  const startDate = formatDate(booking.startDate);
  const endDate = formatDate(booking.endDate);

  return {
    bookingId: booking.id,
    bookingReference: booking.bookingRef,
    customerName: booking.customerSnapshot.fullName.trim() || "Customer",
    customerEmail: booking.customerSnapshot.email.trim() || fallbackEmail?.trim() || "",
    productName: bookingHeadline(booking.items),
    items: booking.items.map((item) => ({ name: item.productName, quantity: item.quantity })),
    status: "approved",
    statusChangedAt: booking.approvedAt || booking.updatedAt,
    bookingUrl: `${origin}${bookingTrackingPath(booking.id, booking.isGuestCheckout)}`,
    isGuest: booking.isGuestCheckout,
    rentalDates: startDate && endDate ? `${startDate} - ${endDate} (${dayLabel})` : undefined,
    pickupDateTime: formatDateTime(booking.startDate) || undefined,
    returnDateTime: formatDateTime(booking.endDate) || undefined,
    pickupLocation: location || undefined,
    bookingStatus: formatStatus(booking.status),
    paymentStatus,
    amountPaid: formatCurrency(amountPaid),
    remainingBalance: formatCurrency(remainingBalance),
    fulfillmentMethod: formatStatus(booking.fulfillmentMethod),
    remainingAction: remainingActions.length ? remainingActions.join("; ") : undefined,
    deliveryKey,
  };
}
