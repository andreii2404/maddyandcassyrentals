import {
  escapeHtml,
  firstName,
  formatPeso,
  renderEmailShell,
  renderSummaryTable,
} from "@/src/lib/emailShell";

export interface CustomerUpdateEmailDetails {
  bookingReference: string;
  customerName: string;
  /** The admin's subject, used as the email subject. */
  subject: string;
  /** The admin's message. Plain text; blank lines start a new paragraph. */
  message: string;
  bookingUrl: string;
  isGuest: boolean;
  /** Shown as a small details card when the update is about a charge. */
  charge?: { label: string; amount: number; paid: boolean };
}

function messageHtml(message: string): string {
  return message
    .trim()
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 12px;color:#292425;font-size:15px;line-height:1.7">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
}

/** Used for both the real email and the admin's preview, so they always match. */
export function buildCustomerUpdateEmail(details: CustomerUpdateEmailDetails) {
  const name = firstName(details.customerName);
  const chargeRows: [string, string][] | null = details.charge
    ? [[details.charge.label, `${formatPeso(details.charge.amount)} (${details.charge.paid ? "Paid" : "Unpaid"})`]]
    : null;
  const chargeHtml = chargeRows ? `<div style="margin-top:8px">${renderSummaryTable(chargeRows)}</div>` : "";

  const html = renderEmailShell({
    preheader: details.subject,
    eyebrow: "BOOKING UPDATE",
    heading: escapeHtml(details.subject),
    introHtml: `Hi ${escapeHtml(name)}, we have an update about your booking <strong>${escapeHtml(details.bookingReference)}</strong>.`,
    bodyHtml: `${messageHtml(details.message)}${chargeHtml}`,
    buttonLabel: "View your booking",
    buttonUrl: details.bookingUrl,
    footerReference: details.bookingReference,
  });

  const text = [
    `Hi ${name}, we have an update about your booking ${details.bookingReference}.`,
    "",
    details.message.trim(),
    ...(details.charge
      ? ["", `${details.charge.label}: ${formatPeso(details.charge.amount)} (${details.charge.paid ? "Paid" : "Unpaid"})`]
      : []),
    "",
    `View your booking: ${details.bookingUrl}`,
  ].join("\n");

  return { subject: details.subject, html, text };
}
