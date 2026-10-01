import { escapeHtml, renderCopyableReference } from "@/src/lib/emailShell";

export interface BookingLookupCodeEmailInput {
  bookingReference: string;
  code: string;
  expiresInMinutes: number;
}

/** One-time code email for Track Booking. It never includes booking details or links. */
export function buildBookingLookupCodeEmail(input: BookingLookupCodeEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const reference = escapeHtml(input.bookingReference);
  const code = escapeHtml(input.code);
  const minutes = String(input.expiresInMinutes);
  const subject = `Your verification code for booking ${input.bookingReference}`;

  const text = [
    "Rental by Maddy & Cassy",
    "",
    `Your verification code is: ${input.code}`,
    "",
    `Enter this code on our website to view booking ${input.bookingReference}.`,
    `The code expires in ${minutes} minutes and can be used once.`,
    "",
    "If you did not request this code, you can ignore this email. Your booking stays private. Never share this code with anyone.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f2f0;color:#252122;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">Your verification code is ${code}. It expires in ${minutes} minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f2f0;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #eadedb;border-radius:24px;overflow:hidden">
          <tr><td style="background:#985766;padding:26px 34px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.82">Rental by</div>
            <div style="margin-top:4px;font-size:24px;font-weight:800">Maddy &amp; Cassy</div>
          </td></tr>
          <tr><td style="padding:34px 34px 10px">
            <div style="color:#a45c6b;font-size:12px;font-weight:800;letter-spacing:1.5px">TRACK BOOKING</div>
            <h1 style="margin:10px 0 14px;font-size:26px;line-height:1.2;color:#211d1e">Your verification code</h1>
            <p style="margin:0;color:#5d5557;font-size:15px;line-height:1.7">Enter this code on our website to view booking <strong>${renderCopyableReference(reference)}</strong>.</p>
          </td></tr>
          <tr><td style="padding:16px 34px">
            <div style="background:#fbf6f4;border:1px solid #eedfdb;border-radius:16px;padding:20px;text-align:center">
              <div style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:800;letter-spacing:10px;color:#292425;-webkit-user-select:all;-moz-user-select:all;user-select:all">${code}</div>
              <div style="margin-top:8px;font-size:12px;color:#8b7d80">Expires in ${minutes} minutes &middot; single use</div>
            </div>
          </td></tr>
          <tr><td style="border-top:1px solid #efe5e2;padding:22px 34px;color:#8b7d80;font-size:12px;line-height:1.6">
            If you did not request this code, you can ignore this email &mdash; your booking stays private. Never share this code with anyone.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
