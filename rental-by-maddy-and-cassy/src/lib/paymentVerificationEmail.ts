import type { RequirementsStatus } from "@/src/types/booking";
import { COPY_REFERENCE_HINT_HTML, renderCopyableReference } from "@/src/lib/emailShell";

export interface PaymentVerifiedEmailDetails {
  bookingId: string;
  paymentId: string;
  bookingReference: string;
  customerName: string;
  customerEmail: string;
  bookingUrl: string;
  requirementsStatus: RequirementsStatus;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || "there";
}

export function buildPaymentVerifiedEmail(details: PaymentVerifiedEmailDetails) {
  const name = escapeHtml(firstName(details.customerName));
  const reference = escapeHtml(details.bookingReference);
  const bookingUrl = escapeHtml(details.bookingUrl);
  const documentsPending = details.requirementsStatus === "not_submitted";
  const subject = `Payment verified for ${details.bookingReference} — Rental by Maddy & Cassy`;
  const reminderText = documentsPending
    ? [
        "",
        "Your required verification documents are still pending.",
        "Your booking is not fully approved or secured until you submit the required verification documents and our team reviews them.",
        `Submit Verification Documents: ${details.bookingUrl}`,
      ]
    : [];

  return {
    subject,
    text: [
      `Hi ${firstName(details.customerName)},`,
      "",
      `Your payment for booking ${details.bookingReference} was verified.`,
      ...reminderText,
      "",
      `Booking reference: ${details.bookingReference}`,
      `View your booking: ${details.bookingUrl}`,
    ].join("\n"),
    html: `<!doctype html><html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;color:#292425;line-height:1.6"><h2>Payment Verified</h2><p>Hi ${name},</p><p>Your payment for booking <strong>${reference}</strong> was verified.</p>${documentsPending ? `<p><strong>Your required verification documents are still pending.</strong><br>Your booking is not fully approved or secured until you submit the required verification documents and our team reviews them.</p><p><a href="${bookingUrl}" style="display:inline-block;background:#a75e6d;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Submit Verification Documents</a></p>` : ""}<p>Booking reference: <strong>${renderCopyableReference(reference)}</strong>${COPY_REFERENCE_HINT_HTML}</p><p><a href="${bookingUrl}">View your booking</a></p><p>This is an automatic update for booking ${reference}. If you need help, reply to this email or contact Rental by Maddy &amp; Cassy.</p></body></html>`,
  };
}
