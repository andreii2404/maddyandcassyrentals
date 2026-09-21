import { describeLoyaltyOutcome, type LoyaltyEmailOutcome } from "@/src/lib/loyaltyOutcome";
import {
  escapeHtml,
  firstName,
  formatManilaDate,
  formatPeso,
  renderEmailShell,
  renderSummaryTable,
} from "@/src/lib/emailShell";

export interface RentalCompletedEmailDetails {
  bookingId: string;
  bookingReference: string;
  customerName: string;
  customerEmail: string;
  items: { name: string; quantity: number }[];
  /** ISO timestamp the rental was marked completed. */
  completedAt: string;
  bookingUrl: string;
  isGuest: boolean;
  rentalTotal: number;
  /** Active (not voided) extra charges. Only the type label is shown, never the admin reason. */
  charges: { label: string; amount: number }[];
  totalPaid: number;
  balance: number;
  loyalty: LoyaltyEmailOutcome;
  deliveryKey?: string;
}

export function buildRentalCompletedEmail(details: RentalCompletedEmailDetails) {
  const name = firstName(details.customerName);
  const itemLines = details.items.map((item) => `${item.name} × ${item.quantity}`);
  const completedOn = formatManilaDate(details.completedAt);
  const loyaltyText = describeLoyaltyOutcome(details.loyalty);

  const summaryRows: [string, string | undefined][] = [
    ["BOOKING NUMBER", details.bookingReference],
    ["RENTED ITEM(S)", itemLines.join("\n")],
    ["COMPLETED ON", completedOn],
    ["RENTAL TOTAL", formatPeso(details.rentalTotal)],
    ...details.charges.map((charge): [string, string] => [charge.label, formatPeso(charge.amount)]),
    ["TOTAL PAID", formatPeso(details.totalPaid)],
    ["BALANCE", formatPeso(details.balance)],
  ];

  const loyaltyHtml = loyaltyText
    ? `<div style="margin-top:16px;padding:14px 18px;border:1px solid #eedfdb;border-radius:16px;background:#fbf6f4"><div style="font-size:11px;font-weight:800;letter-spacing:1.2px;color:#9d5967">LOYALTY</div><p style="margin:6px 0 0;color:#292425;font-size:14px;line-height:1.7">${escapeHtml(loyaltyText)}</p></div>`
    : "";
  const thanks = "Thank you for renting with Maddy & Cassy. We hope to see you again soon!";
  const guestNote = details.isGuest
    ? '<p style="margin:16px 0 0;color:#8b7d80;font-size:12px;line-height:1.6">Your receipt and rental record stay in the secure guest tracker on the browser used at checkout.</p>'
    : "";

  const subject = `Rental ${details.bookingReference} completed — thank you!`;
  const html = renderEmailShell({
    preheader: "Your rental is complete. Here is your summary.",
    eyebrow: "RENTAL COMPLETED",
    heading: `Thank you, ${escapeHtml(name)}!`,
    introHtml: `Your rental is complete. Here is a quick summary for booking <strong>${escapeHtml(details.bookingReference)}</strong>.`,
    bodyHtml: `${renderSummaryTable(summaryRows)}${loyaltyHtml}<p style="margin:16px 0 0;color:#655c5e;font-size:14px;line-height:1.7">${escapeHtml(thanks)}</p>${guestNote}`,
    buttonLabel: "View completed rental",
    buttonUrl: details.bookingUrl,
    footerReference: details.bookingReference,
  });

  const text = [
    `Thank you, ${name}! Your rental is complete.`,
    "",
    `Booking number: ${details.bookingReference}`,
    `Rented item(s): ${itemLines.join(", ")}`,
    ...(completedOn ? [`Completed on: ${completedOn}`] : []),
    `Rental total: ${formatPeso(details.rentalTotal)}`,
    ...details.charges.map((charge) => `${charge.label}: ${formatPeso(charge.amount)}`),
    `Total paid: ${formatPeso(details.totalPaid)}`,
    `Balance: ${formatPeso(details.balance)}`,
    ...(loyaltyText ? ["", `Loyalty: ${loyaltyText}`] : []),
    "",
    thanks,
    "",
    `View your rental: ${details.bookingUrl}`,
  ].join("\n");

  return { subject, html, text };
}
