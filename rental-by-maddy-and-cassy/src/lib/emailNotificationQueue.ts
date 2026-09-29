import type { BookingStatusEmailDetails } from "@/src/lib/bookingStatusEmailContent";
import type { RequirementsStatus } from "@/src/types/booking";

export interface EmailNotificationQueueRow {
  booking_id: string;
  event_key: string;
  email_type: "booking_approved" | "booking_returned" | "booking_confirmation_contract" | "payment_rejected" | "payment_verified";
  recipient_email: string;
  recipient_name: string;
  subject: string;
  status: "pending";
}

export interface PaymentRejectionEmailDetails {
  bookingId: string;
  paymentId: string;
  bookingReference: string;
  customerName: string;
  customerEmail: string;
  rejectionReason: string;
  bookingUrl: string;
}

export interface PaymentVerifiedEmailQueueDetails {
  bookingId: string;
  paymentId: string;
  customerName: string;
  customerEmail: string;
  requirementsStatus: RequirementsStatus;
}

export function buildPaymentVerifiedQueueRow(
  details: PaymentVerifiedEmailQueueDetails,
  subject: string,
): EmailNotificationQueueRow {
  return {
    booking_id: details.bookingId,
    event_key: `payment-verified-${details.paymentId}`,
    email_type: "payment_verified",
    recipient_email: details.customerEmail,
    recipient_name: details.customerName.trim() || "Customer",
    subject,
    status: "pending",
  };
}

export function buildPaymentRejectionQueueRow(
  details: PaymentRejectionEmailDetails,
  subject: string,
): EmailNotificationQueueRow {
  return {
    booking_id: details.bookingId,
    event_key: `payment-rejected-${details.paymentId}`,
    email_type: "payment_rejected",
    recipient_email: details.customerEmail,
    recipient_name: details.customerName.trim() || "Customer",
    subject,
    status: "pending",
  };
}

export function buildSignedAgreementQueueRow(input: {
  bookingId: string;
  eventKey?: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
}): EmailNotificationQueueRow {
  return {
    booking_id: input.bookingId,
    event_key: input.eventKey ?? `booking-confirmation-contract-${input.bookingId}`,
    email_type: "booking_confirmation_contract",
    recipient_email: input.recipientEmail,
    recipient_name: input.recipientName.trim() || "Customer",
    subject: input.subject,
    status: "pending",
  };
}

export function buildEmailNotificationQueueRow(
  details: BookingStatusEmailDetails,
  subject: string,
): EmailNotificationQueueRow {
  return {
    booking_id: details.bookingId,
    event_key: details.deliveryKey ?? `booking-${details.status}-${details.bookingId}-${details.statusChangedAt}`,
    email_type: details.status === "approved" ? "booking_approved" : "booking_returned",
    recipient_email: details.customerEmail,
    recipient_name: details.customerName.trim() || "Customer",
    subject,
    status: "pending",
  };
}
