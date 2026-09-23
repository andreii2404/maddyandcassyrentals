import type { BookingStatus } from "@/src/types/booking";

export type EmailBookingStatus = Extract<BookingStatus, "approved" | "returned">;

export interface BookingStatusEmailDetails {
  bookingId: string;
  bookingReference: string;
  customerName: string;
  customerEmail: string;
  productName?: string;
  /** Every rented item, listed one per line in the approval email. */
  items?: { name: string; quantity: number }[];
  status: EmailBookingStatus;
  statusChangedAt: string;
  bookingUrl: string;
  isGuest?: boolean;
  rentalDates?: string;
  /** Pre-formatted, e.g. "Sep 12, 2026, 9:00 AM". */
  pickupDateTime?: string;
  returnDateTime?: string;
  pickupLocation?: string;
  /** Human-readable booking status, e.g. "Approved". */
  bookingStatus?: string;
  paymentStatus?: string;
  amountPaid?: string;
  remainingBalance?: string;
  fulfillmentMethod?: string;
  remainingAction?: string;
  deliveryKey?: string;
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

export function buildBookingStatusEmail(details: BookingStatusEmailDetails) {
  const approved = details.status === "approved";
  const name = escapeHtml(firstName(details.customerName));
  const reference = escapeHtml(details.bookingReference);
  const item = details.productName ? escapeHtml(details.productName) : "your selected rental";
  const bookingUrl = escapeHtml(details.bookingUrl);
  const isGuest = details.isGuest === true;

  const subject = approved
    ? `Booking ${details.bookingReference} approved — Rental by Maddy & Cassy`
    : `Rental ${details.bookingReference} completed — thank you!`;
  const eyebrow = approved ? "BOOKING APPROVED" : "RENTAL COMPLETED";
  const heading = approved ? `Good news, ${name}!` : `Thank you, ${name}!`;
  const introduction = approved
    ? `Your booking for <strong>${item}</strong> has been successfully verified and approved. Your signed rental contract PDF is attached — please keep this email and the contract handy.`
    : `We have recorded the return of <strong>${item}</strong>. Booking <strong>${reference}</strong> is now complete.`;
  const nextTitle = approved ? "What happens next" : "Your completed rental";
  const nextCopy = approved
    ? isGuest
      ? "Open the secure guest tracker in the same browser used for checkout to follow pickup or delivery updates. No customer account is required."
      : "Open your booking to follow pickup or delivery updates and keep your signed contract and payment records together."
    : isGuest
      ? "Your payment records, receipt, invoice, and completed rental remain available in the secure guest tracker on the browser used for checkout."
      : "Your booking history, payment records, receipt, and invoice remain available in your account. You can also share a review to help future renters choose with confidence.";
  const buttonLabel = approved ? "Continue booking" : "View completed rental";
  const handoverLabel = details.fulfillmentMethod?.toLowerCase() === "delivery" ? "Delivery" : "Pickup";
  const itemLines = (details.items ?? []).map((item) => `${item.name} × ${item.quantity}`);
  const summaryRows = [
    approved ? ["CUSTOMER", details.customerName.trim()] : undefined,
    approved && itemLines.length ? ["RENTAL ITEMS", itemLines.join("\n")] : undefined,
    ["RENTAL DATES", details.rentalDates],
    approved ? [`${handoverLabel.toUpperCase()} DATE & TIME`, details.pickupDateTime] : undefined,
    approved ? ["RETURN DATE & TIME", details.returnDateTime] : undefined,
    approved ? [`${handoverLabel.toUpperCase()} LOCATION`, details.pickupLocation] : undefined,
    ["PAYMENT STATUS", details.paymentStatus],
    ["AMOUNT PAID", details.amountPaid],
    ["REMAINING BALANCE", details.remainingBalance],
    ["FULFILLMENT", details.fulfillmentMethod],
    approved ? ["BOOKING STATUS", details.bookingStatus] : undefined,
  ].filter((row): row is [string, string] => Boolean(row?.[1]));
  const summaryHtml = summaryRows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${summaryRows
        .map(
          ([label, value]) => `<tr><td valign="top" style="padding:7px 12px 7px 0;color:#8b7d80;font-size:12px;font-weight:700;letter-spacing:.8px;text-transform:uppercase">${escapeHtml(label)}</td><td align="right" style="padding:7px 0;color:#292425;font-size:14px;font-weight:700">${escapeHtml(value).replaceAll("\n", "<br>")}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const reminders = approved
    ? [
        ...(details.remainingAction
          ? details.remainingAction.split(/;\s*/).filter(Boolean).map((action) => `${action}.`)
          : []),
        `Please have your booking number (${details.bookingReference}) ready when you ${handoverLabel === "Delivery" ? "receive" : "collect"} your rental.`,
        `Return your rental${details.returnDateTime ? ` by ${details.returnDateTime}` : " on the return date and time above"}, in the same condition you received it.`,
        "Need to change something? Reply to this email and we will be happy to help.",
      ]
    : [];
  const remindersHtml = reminders.length
    ? `<h2 style="margin:22px 0 8px;font-size:18px;color:#292425">Important reminders</h2><ul style="margin:0 0 24px;padding-left:20px;color:#655c5e;font-size:14px;line-height:1.7">${reminders.map((reminder) => `<li>${escapeHtml(reminder)}</li>`).join("")}</ul>`
    : "";
  const text = approved
    ? [
        `Good news, ${firstName(details.customerName)}! Booking ${details.bookingReference} for ${details.productName || "your selected rental"} has been approved.`,
        "",
        "Booking summary",
        `Customer: ${details.customerName.trim() || "Customer"}`,
        `Booking number: ${details.bookingReference}`,
        ...(itemLines.length ? [`Rental item(s): ${itemLines.join(", ")}`] : []),
        ...(details.rentalDates ? [`Rental dates: ${details.rentalDates}`] : []),
        ...(details.pickupDateTime ? [`${handoverLabel} date and time: ${details.pickupDateTime}`] : []),
        ...(details.returnDateTime ? [`Return date and time: ${details.returnDateTime}`] : []),
        ...(details.pickupLocation ? [`${handoverLabel} location: ${details.pickupLocation}`] : []),
        ...(details.paymentStatus ? [`Payment status: ${details.paymentStatus}`] : []),
        ...(details.amountPaid ? [`Amount paid: ${details.amountPaid}`] : []),
        ...(details.remainingBalance ? [`Remaining balance: ${details.remainingBalance}`] : []),
        ...(details.fulfillmentMethod ? [`Fulfillment: ${details.fulfillmentMethod}`] : []),
        ...(details.bookingStatus ? [`Booking status: ${details.bookingStatus}`] : []),
        "",
        "Important reminders",
        ...reminders.map((reminder) => `- ${reminder}`),
        "",
        `View your booking${isGuest ? " in the same browser used for guest checkout" : ""}: ${details.bookingUrl}`,
      ].join("\n")
    : `Thank you, ${firstName(details.customerName)}! The return for booking ${details.bookingReference} (${details.productName || "your rental"}) has been recorded and the rental is complete. View your receipt, invoice, booking history, or leave a review${isGuest ? " in the same browser used for guest checkout" : ""} here: ${details.bookingUrl}`;

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f2f0;color:#252122;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${approved ? "Your rental request was approved." : "Your rental return was completed."}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f2f0;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #eadedb;border-radius:24px;overflow:hidden">
          <tr><td style="background:#985766;padding:26px 34px;color:#ffffff">
            <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.82">Rental by</div>
            <div style="margin-top:4px;font-size:24px;font-weight:800">Maddy &amp; Cassy</div>
          </td></tr>
          <tr><td style="padding:36px 34px 16px">
            <div style="color:#a45c6b;font-size:12px;font-weight:800;letter-spacing:1.5px">${eyebrow}</div>
            <h1 style="margin:10px 0 14px;font-size:30px;line-height:1.15;color:#211d1e">${heading}</h1>
            <p style="margin:0;color:#5d5557;font-size:16px;line-height:1.7">${introduction}</p>
          </td></tr>
          <tr><td style="padding:12px 34px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf6f4;border:1px solid #eedfdb;border-radius:16px">
              <tr><td style="padding:20px">
                <div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#9d5967">BOOKING REFERENCE</div>
                <div style="margin-top:6px;font-size:19px;font-weight:800;color:#292425">${reference}</div>
              </td></tr>
            </table>
          </td></tr>
          ${summaryHtml ? `<tr><td style="padding:4px 34px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffaf8;border:1px solid #f0e4e0;border-radius:16px"><tr><td style="padding:14px 20px">${summaryHtml}</td></tr></table></td></tr>` : ""}
          <tr><td style="padding:16px 34px 34px">
            <h2 style="margin:0 0 8px;font-size:18px;color:#292425">${nextTitle}</h2>
            <p style="margin:0;color:#655c5e;font-size:14px;line-height:1.7">${nextCopy}</p>
            ${remindersHtml || '<div style="height:24px"></div>'}
            <a href="${bookingUrl}" style="display:inline-block;background:#a75e6d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:14px 22px;border-radius:12px">${buttonLabel}</a>
            ${isGuest ? '<p style="margin:18px 0 0;color:#8b7d80;font-size:12px;line-height:1.6"><strong>Guest checkout:</strong> no account is required. For your privacy, this link opens the booking through the temporary session stored in the browser used at checkout. Guest bookings do not earn birthday or loyalty perks.</p>' : ''}
          </td></tr>
          <tr><td style="border-top:1px solid #efe5e2;padding:22px 34px;color:#8b7d80;font-size:12px;line-height:1.6">
            This is an automatic update for booking ${reference}. If you need help, reply to this email or contact Rental by Maddy &amp; Cassy.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
