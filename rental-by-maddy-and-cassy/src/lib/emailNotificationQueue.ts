import type { BookingStatusEmailDetails } from "@/src/lib/bookingStatusEmailContent";

export interface EmailNotificationQueueRow {
  booking_id: string;
  email_type: "booking_approved" | "booking_returned" | "booking_confirmation_contract";
  recipient_email: string;
  recipient_name: string;
  subject: string;
  status: "pending";
}

export function buildSignedAgreementQueueRow(input: {
  bookingId: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
}): EmailNotificationQueueRow {
  return {
    booking_id: input.bookingId,
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
    email_type: details.status === "approved" ? "booking_approved" : "booking_returned",
    recipient_email: details.customerEmail,
    recipient_name: details.customerName.trim() || "Customer",
    subject,
    status: "pending",
  };
}
