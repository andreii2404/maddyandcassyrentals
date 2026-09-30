import type { PaymentRejectionEmailDetails } from "@/src/lib/emailNotificationQueue";
import { paymentRejectionBookingUrl } from "@/supabase/functions/_shared/paymentRejectionBookingUrl";

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

export function buildPaymentRejectionEmail(details: PaymentRejectionEmailDetails) {
  const customerName = details.customerName.trim() || "Customer";
  const name = escapeHtml(firstName(customerName));
  const fullName = escapeHtml(customerName);
  const reference = escapeHtml(details.bookingReference);
  const reason = escapeHtml(details.rejectionReason);
  const bookingUrl = paymentRejectionBookingUrl(details.bookingId, details.isGuestCheckout);
  const subject = `Payment Rejected – Booking ${details.bookingReference}`;

  return {
    subject,
    text: [
      `Hi ${firstName(customerName)},`,
      "",
      `Your payment proof for booking ${details.bookingReference} has been rejected. Please review the reason below and submit a new payment proof.`,
      "",
      "Rejection Reason:",
      details.rejectionReason,
      "",
      `Resubmit your payment proof: ${bookingUrl}`,
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f2f0;color:#252122;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your payment proof for booking ${reference} has been rejected. Review the reason and submit a new payment proof.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f2f0;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #eadedb;border-radius:24px;overflow:hidden">
          <tr><td style="background:#985766;padding:26px 34px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.82">Rental by</div>
            <div style="margin-top:4px;font-size:24px;font-weight:800">Maddy &amp; Cassy</div>
          </td></tr>
          <tr><td style="padding:36px 34px 16px">
            <div style="color:#a45c6b;font-size:12px;font-weight:800;letter-spacing:1.5px">PAYMENT UPDATE</div>
            <h1 style="margin:10px 0 14px;font-size:30px;line-height:1.15;color:#211d1e">Payment Proof Rejected</h1>
            <p style="margin:0;color:#5d5557;font-size:16px;line-height:1.7">Hi ${name}, your payment proof for booking <strong>${reference}</strong> has been rejected. Please review the reason below and submit a new payment proof.</p>
          </td></tr>
          <tr><td style="padding:12px 34px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf6f4;border:1px solid #eedfdb;border-radius:16px">
              <tr><td style="padding:20px">
                <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#9d5967">CUSTOMER</div>
                <div style="margin-top:6px;font-size:16px;font-weight:700;color:#292425">${fullName}</div>
                <div style="margin-top:18px;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#9d5967">BOOKING REFERENCE</div>
                <div style="margin-top:6px;font-size:19px;font-weight:800;color:#292425">${reference}</div>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:4px 34px 12px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf8;border:1px solid #f0e4e0;border-radius:16px">
              <tr><td style="padding:20px">
                <div style="font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9d5967">Rejection Reason</div>
                <p style="margin:8px 0 0;color:#5d5557;font-size:15px;line-height:1.7">${reason}</p>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:16px 34px 34px">
            <h2 style="margin:0 0 8px;font-size:18px;color:#292425">What to do next</h2>
            <p style="margin:0;color:#655c5e;font-size:14px;line-height:1.7">Please correct the issue described above, then submit a new payment proof from your booking page. We will review the updated proof as soon as possible.</p>
            <div style="height:24px"></div>
            <a href="${bookingUrl}" style="display:inline-block;background:#a75e6d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 22px;border-radius:12px">Resubmit Payment</a>
          </td></tr>
          <tr><td style="border-top:1px solid #efe5e2;padding:22px 34px;color:#8b7d80;font-size:12px;line-height:1.6">
            This is an automatic update for booking ${reference}. If you need help, reply to this email or contact Rental by Maddy &amp; Cassy.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}
