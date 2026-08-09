import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFImage,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const ROSE = rgb(0.66, 0.36, 0.42);
const BLUSH = rgb(0.97, 0.91, 0.91);
const INK = rgb(0.15, 0.15, 0.15);
const MUTED = rgb(0.38, 0.38, 0.38);
const BORDER = rgb(0.86, 0.84, 0.84);

interface CustomerDocumentBase {
  bookingRef: string;
  customerName: string;
  customerEmail: string;
  productName: string;
  rentalDates: string;
  amount: number;
  issuedAt: string;
  isDemo?: boolean;
}

export interface InvoicePdfInput extends CustomerDocumentBase {
  invoiceNumber: string;
  totalAmount?: number;
  amountDueNow?: number;
  remainingBalance?: number;
  paymentLabel?: string;
}

export interface ReceiptPdfInput extends CustomerDocumentBase {
  receiptNumber: string;
  paymentReference: string;
  paymentMethod: string;
}

export interface AgreementPdfInput extends CustomerDocumentBase {
  address: string;
  phone: string;
  fulfillmentMethod: string;
  customerLocation: string;
  includedAccessories: string[];
  termsVersion: string;
  signedAt: string;
  typedFullName: string;
  signatureBytes?: Uint8Array;
  signatureContentType?: string;
  paymentReference: string;
  confirmedAt: string;
  businessSignerName?: string;
  businessSignedAt?: string;
}

function safeText(value: string): string {
  return value
    .replaceAll("₱", "PHP ")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replace(/[^\x20-\x7E\n]/g, "");
}

function money(amount: number): string {
  return `PHP ${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of safeText(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function addBrandHeader(
  page: PDFPage,
  bold: PDFFont,
  title: string,
  reference: string,
  isDemo = false,
): number {
  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 138,
    width: PAGE_WIDTH,
    height: 138,
    color: BLUSH,
  });
  page.drawText("MADDY & CASSY RENTALS", {
    x: MARGIN,
    y: PAGE_HEIGHT - 55,
    size: 11,
    font: bold,
    color: ROSE,
  });
  if (isDemo) {
    page.drawRectangle({
      x: PAGE_WIDTH - MARGIN - 174,
      y: PAGE_HEIGHT - 67,
      width: 174,
      height: 25,
      color: rgb(1, 0.84, 0.84),
    });
    page.drawText("DEMO - NOT A VALID PAYMENT RECORD", {
      x: PAGE_WIDTH - MARGIN - 165,
      y: PAGE_HEIGHT - 58,
      size: 6.8,
      font: bold,
      color: ROSE,
    });
  }
  page.drawText(safeText(title), {
    x: MARGIN,
    y: PAGE_HEIGHT - 88,
    size: 25,
    font: bold,
    color: INK,
  });
  page.drawText(safeText(reference), {
    x: MARGIN,
    y: PAGE_HEIGHT - 113,
    size: 10,
    font: bold,
    color: ROSE,
  });
  return PAGE_HEIGHT - 174;
}

function addFooter(page: PDFPage, regular: PDFFont, text: string): void {
  page.drawLine({
    start: { x: MARGIN, y: 36 },
    end: { x: PAGE_WIDTH - MARGIN, y: 36 },
    thickness: 0.6,
    color: BORDER,
  });
  page.drawText(safeText(text), {
    x: MARGIN,
    y: 21,
    size: 7.5,
    font: regular,
    color: MUTED,
  });
}

function drawField(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
): number {
  page.drawText(safeText(label.toUpperCase()), {
    x,
    y,
    size: 7,
    font: bold,
    color: MUTED,
  });
  const lines = wrap(value || "-", regular, 10, width);
  let nextY = y - 16;
  for (const line of lines) {
    page.drawText(line || " ", { x, y: nextY, size: 10, font: regular, color: INK });
    nextY -= 13;
  }
  return nextY - 7;
}

function drawSummary(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  input: CustomerDocumentBase,
  y: number,
): number {
  const columnWidth = (PAGE_WIDTH - MARGIN * 2 - 20) / 2;
  const leftY = drawField(page, regular, bold, "Customer", input.customerName, MARGIN, y, columnWidth);
  const rightY = drawField(
    page,
    regular,
    bold,
    "Email",
    input.customerEmail,
    MARGIN + columnWidth + 20,
    y,
    columnWidth,
  );
  y = Math.min(leftY, rightY);
  const itemY = drawField(page, regular, bold, "Rental item", input.productName, MARGIN, y, columnWidth);
  const datesY = drawField(
    page,
    regular,
    bold,
    "Rental dates",
    input.rentalDates,
    MARGIN + columnWidth + 20,
    y,
    columnWidth,
  );
  return Math.min(itemY, datesY);
}

function drawAmountBox(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  amount: number,
  y: number,
  label: string,
): number {
  page.drawRectangle({
    x: MARGIN,
    y: y - 58,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 58,
    color: BLUSH,
  });
  page.drawText(safeText(label.toUpperCase()), {
    x: MARGIN + 16,
    y: y - 23,
    size: 8,
    font: bold,
    color: ROSE,
  });
  const amountText = money(amount);
  page.drawText(amountText, {
    x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(amountText, 18) - 16,
    y: y - 35,
    size: 18,
    font: bold,
    color: INK,
  });
  page.drawText("Rental fee x 1", {
    x: MARGIN + 16,
    y: y - 42,
    size: 9,
    font: regular,
    color: MUTED,
  });
  return y - 82;
}

export async function createInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = addBrandHeader(
    page,
    bold,
    input.isDemo ? "Demo Rental Invoice" : "Rental Invoice",
    input.invoiceNumber,
    input.isDemo,
  );
  y = drawSummary(page, regular, bold, input, y);
  const totalAmount = input.totalAmount ?? input.amount;
  const amountDueNow = input.amountDueNow ?? input.amount;
  const remainingBalance = input.remainingBalance ?? Math.max(0, totalAmount - amountDueNow);
  y = drawAmountBox(page, regular, bold, totalAmount, y, "Total rental amount");
  const dueY = drawField(
    page,
    regular,
    bold,
    "Payment selected",
    `${input.paymentLabel ?? "Amount due"}: ${money(amountDueNow)}`,
    MARGIN,
    y,
    250,
  );
  const balanceY = drawField(
    page,
    regular,
    bold,
    "Balance after this payment",
    money(remainingBalance),
    MARGIN + 290,
    y,
    200,
  );
  y = Math.min(dueY, balanceY);
  drawField(page, regular, bold, "Booking reference", input.bookingRef, MARGIN, y, 230);
  drawField(page, regular, bold, "Issued", input.issuedAt, MARGIN + 270, y, 220);
  addFooter(
    page,
    regular,
    input.isDemo
      ? "DEMO ONLY - This invoice is for flow testing and is not a valid demand for payment."
      : "This booking invoice is payable through the secure PayMongo checkout linked to the reservation.",
  );
  pdf.setTitle(`Invoice ${safeText(input.invoiceNumber)}`);
  pdf.setAuthor("Rental by Maddy & Cassy");
  return pdf.save();
}

export async function createReceiptPdf(input: ReceiptPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = addBrandHeader(
    page,
    bold,
    input.isDemo ? "Demo Payment Receipt" : "Official Payment Receipt",
    input.receiptNumber,
    input.isDemo,
  );
  y = drawSummary(page, regular, bold, input, y);
  y = drawAmountBox(page, regular, bold, input.amount, y, "Payment received");
  y = drawField(
    page,
    regular,
    bold,
    input.isDemo ? "Demo transaction reference" : "PayMongo transaction reference",
    input.paymentReference,
    MARGIN,
    y,
    300,
  );
  drawField(page, regular, bold, "Payment method", input.paymentMethod, MARGIN + 330, y + 23, 160);
  addFooter(
    page,
    regular,
    input.isDemo
      ? `DEMO ONLY - No money was received for booking ${input.bookingRef}. This receipt is not valid.`
      : `Payment received for booking ${input.bookingRef}. Keep this receipt for your records.`,
  );
  pdf.setTitle(`Receipt ${safeText(input.receiptNumber)}`);
  pdf.setAuthor("Rental by Maddy & Cassy");
  return pdf.save();
}

async function embedSignature(
  pdf: PDFDocument,
  bytes?: Uint8Array,
  contentType?: string,
): Promise<PDFImage | null> {
  if (!bytes?.length) return null;
  try {
    if (contentType?.toLowerCase().includes("png")) return await pdf.embedPng(bytes);
    return await pdf.embedJpg(bytes);
  } catch {
    try {
      return await pdf.embedPng(bytes);
    } catch {
      return null;
    }
  }
}

export async function createFinalAgreementPdf(
  input: AgreementPdfInput,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageOne = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = addBrandHeader(
    pageOne,
    bold,
    input.isDemo ? "Demo Rental Agreement" : "Rental Agreement",
    `Booking ${input.bookingRef}`,
    input.isDemo,
  );
  y = drawSummary(pageOne, regular, bold, input, y);
  const half = (PAGE_WIDTH - MARGIN * 2 - 20) / 2;
  const phoneY = drawField(pageOne, regular, bold, "Phone", input.phone, MARGIN, y, half);
  const addressY = drawField(
    pageOne,
    regular,
    bold,
    "Address",
    input.address,
    MARGIN + half + 20,
    y,
    half,
  );
  y = Math.min(phoneY, addressY);
  const methodY = drawField(
    pageOne,
    regular,
    bold,
    "Handover method",
    input.fulfillmentMethod,
    MARGIN,
    y,
    half,
  );
  const locationY = drawField(
    pageOne,
    regular,
    bold,
    "Location",
    input.customerLocation,
    MARGIN + half + 20,
    y,
    half,
  );
  y = Math.min(methodY, locationY);
  y = drawField(
    pageOne,
    regular,
    bold,
    "Included accessories",
    input.includedAccessories.join(", ") || "None listed",
    MARGIN,
    y,
    PAGE_WIDTH - MARGIN * 2,
  );
  y = drawAmountBox(pageOne, regular, bold, input.amount, y, "Reservation payment received");
  drawField(pageOne, regular, bold, "Payment confirmation", input.paymentReference, MARGIN, y, 270);
  drawField(pageOne, regular, bold, "Reservation secured", input.confirmedAt, MARGIN + 310, y, 180);
  addFooter(
    pageOne,
    regular,
    `${input.isDemo ? "DEMO FLOW TEST - " : ""}Agreement terms version ${input.termsVersion} - Page 1 of 2`,
  );

  const pageTwo = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  y = PAGE_HEIGHT - MARGIN;
  if (input.isDemo) {
    pageTwo.drawText("DEMO FLOW TEST - NOT A VALID PAYMENT RECORD", {
      x: PAGE_WIDTH - MARGIN - 225,
      y,
      size: 7.5,
      font: bold,
      color: ROSE,
    });
    y -= 24;
  }
  pageTwo.drawText("RENTAL TERMS & CONDITIONS", {
    x: MARGIN,
    y,
    size: 15,
    font: bold,
    color: ROSE,
  });
  y -= 31;

  const terms = [
    "The rented item remains the property of Rental by Maddy & Cassy at all times.",
    "The customer agrees to return the item on or before the agreed return date and through the agreed pickup or delivery arrangement.",
    "The customer is responsible for reasonable care of the item and will use it only for its intended purpose.",
    "Late returns may result in additional charges communicated by the business.",
    "Damage, loss, or missing accessories will be assessed by the business. The customer agrees to cooperate in resolving the resulting costs.",
    "Payment is confirmed only through the verified PayMongo transaction shown in this agreement and its corresponding receipt.",
    "The customer authorizes the electronic signature below and agrees that it is binding for this booking.",
    "Personal information and verification documents are used only for identity verification, booking fulfillment, legal compliance, and legitimate business records.",
  ];

  terms.forEach((term, index) => {
    const lines = wrap(`${index + 1}. ${term}`, regular, 10.5, PAGE_WIDTH - MARGIN * 2);
    for (const line of lines) {
      pageTwo.drawText(line, { x: MARGIN, y, size: 10.5, font: regular, color: INK });
      y -= 17;
    }
    y -= 9;
  });

  y -= 14;
  pageTwo.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.7,
    color: BORDER,
  });
  y -= 29;
  pageTwo.drawText("CUSTOMER ELECTRONIC SIGNATURE", {
    x: MARGIN,
    y,
    size: 9,
    font: bold,
    color: MUTED,
  });
  y -= 18;

  const signature = await embedSignature(pdf, input.signatureBytes, input.signatureContentType);
  if (signature) {
    const scale = Math.min(230 / signature.width, 80 / signature.height, 1);
    pageTwo.drawImage(signature, {
      x: MARGIN,
      y: y - signature.height * scale,
      width: signature.width * scale,
      height: signature.height * scale,
    });
  } else {
    pageTwo.drawText(safeText(input.typedFullName), {
      x: MARGIN,
      y: y - 34,
      size: 18,
      font: bold,
      color: INK,
    });
  }
  y -= 96;
  drawField(pageTwo, regular, bold, "Legally signed by", input.typedFullName, MARGIN, y, half);
  drawField(pageTwo, regular, bold, "Signed at", input.signedAt, MARGIN + half + 20, y, half);
  if (input.businessSignerName) {
    y -= 68;
    pageTwo.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.7,
      color: BORDER,
    });
    y -= 27;
    pageTwo.drawText("BUSINESS COUNTERSIGNATURE", {
      x: MARGIN,
      y,
      size: 9,
      font: bold,
      color: MUTED,
    });
    y -= 24;
    drawField(pageTwo, regular, bold, "Authorized business signer", input.businessSignerName, MARGIN, y, half);
    drawField(pageTwo, regular, bold, "Countersigned at", input.businessSignedAt || input.confirmedAt, MARGIN + half + 20, y, half);
  }
  addFooter(
    pageTwo,
    regular,
    `${input.isDemo ? "DEMO FLOW TEST - " : ""}Agreement terms version ${input.termsVersion} - Page 2 of 2`,
  );

  pdf.setTitle(`Signed Rental Agreement - ${safeText(input.bookingRef)}`);
  pdf.setSubject("Electronically signed rental agreement for a secured reservation");
  pdf.setAuthor("Rental by Maddy & Cassy");
  return pdf.save();
}
