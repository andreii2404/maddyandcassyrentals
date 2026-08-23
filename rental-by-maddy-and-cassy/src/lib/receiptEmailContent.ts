import { formatManilaDateTime } from "@/src/lib/rentalTiming";

export interface ReceiptEmailDetails {
  bookingReference: string;
  customerName: string;
  amountPaid: number;
  receiptNumber: string;
  startDate: string;
  endDate: string;
  bookingUrl: string;
  isGuest?: boolean;
  /** True when the PDF could not be attached (e.g. storage read failed) — email still links to the live view instead. */
  receiptAttached: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

function formatCurrency(amount: number): string {
  return `PHP ${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildReceiptEmail(details: ReceiptEmailDetails) {
  const name = escapeHtml(firstName(details.customerName));
  const reference = escapeHtml(details.bookingReference);
  const receiptNumber = escapeHtml(details.receiptNumber);
  const amount = formatCurrency(details.amountPaid);
  const dateRange = `${formatManilaDateTime(details.startDate)} to ${formatManilaDateTime(details.endDate)}`;
  const bookingUrl = escapeHtml(details.bookingUrl);
  const isGuest = details.isGuest === true;
  const viewCopy = details.receiptAttached
    ? "Your official receipt is attached to this email as a PDF."
    : "Open your booking to view the official receipt.";

  const subject = `Official receipt for booking ${details.bookingReference} — Rental by Maddy & Cassy`;

  const text = `Hi ${firstName(details.customerName)},

Your payment for booking ${details.bookingReference} has been verified.

Receipt number: ${details.receiptNumber}
Amount paid: ${amount}
Booking reference: ${details.bookingReference}
Reserved dates: ${dateRange}

${viewCopy}
View your booking${isGuest ? " in the same browser used for guest checkout" : ""}: ${details.bookingUrl}`;

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f2f0;color:#252122;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your payment was verified and your official receipt is ready.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f2f0;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #eadedb;border-radius:24px;overflow:hidden">
          <tr><td style="background:#985766;padding:26px 34px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.82">Rental by</div>
            <div style="margin-top:4px;font-size:24px;font-weight:800">Maddy &amp; Cassy</div>
          </td></tr>
          <tr><td style="padding:36px 34px 16px">
            <div style="color:#a45c6b;font-size:12px;font-weight:800;letter-spacing:1.5px">PAYMENT VERIFIED</div>
            <h1 style="margin:10px 0 14px;font-size:30px;line-height:1.15;color:#211d1e">Thanks, ${name}!</h1>
            <p style="margin:0;color:#5d5557;font-size:16px;line-height:1.7">Your payment has been verified and your rental dates are reserved. Here is your official receipt.</p>
          </td></tr>
          <tr><td style="padding:12px 34px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf6f4;border:1px solid #eedfdb;border-radius:16px">
              <tr><td style="padding:20px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-bottom:12px;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#9d5967">BOOKING REFERENCE</td>
                    <td style="padding-bottom:12px;text-align:right;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#9d5967">RECEIPT NO.</td>
                  </tr>
                  <tr>
                    <td style="font-size:17px;font-weight:800;color:#292425">${reference}</td>
                    <td style="text-align:right;font-size:17px;font-weight:800;color:#292425">${receiptNumber}</td>
                  </tr>
                  <tr><td colspan="2" style="padding-top:16px;border-top:1px solid #eedfdb"></td></tr>
                  <tr>
                    <td style="padding-top:12px;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#9d5967">AMOUNT PAID</td>
                    <td style="padding-top:12px;text-align:right;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#9d5967">RESERVED DATES</td>
                  </tr>
                  <tr>
                    <td style="font-size:17px;font-weight:800;color:#292425">${amount}</td>
                    <td style="text-align:right;font-size:13px;font-weight:800;color:#292425">${escapeHtml(dateRange)}</td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:16px 34px 34px">
            <p style="margin:0 0 24px;color:#655c5e;font-size:14px;line-height:1.7">${viewCopy}</p>
            <a href="${bookingUrl}" style="display:inline-block;background:#a75e6d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 22px;border-radius:12px">View your booking</a>
            ${isGuest ? '<p style="margin:18px 0 0;color:#8b7d80;font-size:12px;line-height:1.6"><strong>Guest checkout:</strong> this link opens through the temporary session stored in the browser used at checkout.</p>' : ''}
          </td></tr>
          <tr><td style="border-top:1px solid #efe5e2;padding:22px 34px;color:#8b7d80;font-size:12px;line-height:1.6">
            This is an automatic receipt for booking ${reference}. If you need help, reply to this email or contact Rental by Maddy &amp; Cassy.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
