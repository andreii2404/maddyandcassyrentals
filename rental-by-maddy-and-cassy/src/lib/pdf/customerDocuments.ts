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

/** One row of the itemized table shared by every customer document. */
export interface DocumentLineItem {
  productName: string;
  pricePerDay: number;
  quantity: number;
  rentalDays: number;
  lineTotal: number;
  includedAccessories?: string[];
  /** Present only on the signed agreement -- the frozen unit(s) assigned to this line. */
  units?: { unitCode: string; serialNumber: string | null }[];
}

interface CustomerDocumentBase {
  bookingRef: string;
  customerName: string;
  customerEmail: string;
  items: DocumentLineItem[];
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
  return drawField(page, regular, bold, "Rental dates", input.rentalDates, MARGIN, y, PAGE_WIDTH - MARGIN * 2);
}

function itemsCaption(items: DocumentLineItem[]): string {
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const itemLabel = items.length === 1 ? "item" : "items";
  const unitLabel = totalUnits === 1 ? "unit" : "units";
  return `${items.length} ${itemLabel} (${totalUnits} ${unitLabel} total)`;
}

function drawAmountBox(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  amount: number,
  y: number,
  label: string,
  caption: string,
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
  page.drawText(safeText(caption), {
    x: MARGIN + 16,
    y: y - 42,
    size: 9,
    font: regular,
    color: MUTED,
  });
  return y - 82;
}

interface TableColumn {
  label: string;
  width: number;
  align: "left" | "right";
}

const ITEM_COLUMNS: TableColumn[] = [
  { label: "PRODUCT", width: 190, align: "left" },
  { label: "PRICE/DAY", width: 90, align: "right" },
  { label: "QTY", width: 50, align: "right" },
  { label: "DAYS", width: 50, align: "right" },
  { label: "LINE TOTAL", width: 119.28, align: "right" },
];

const ITEM_TABLE_BOTTOM_LIMIT = 130;

function columnX(index: number): number {
  let x = MARGIN;
  for (let i = 0; i < index; i += 1) x += ITEM_COLUMNS[i].width;
  return x;
}

function drawTableCell(
  page: PDFPage,
  font: PDFFont,
  text: string,
  columnIndex: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
): void {
  const column = ITEM_COLUMNS[columnIndex];
  const x = columnX(columnIndex);
  const safe = safeText(text);
  if (column.align === "left") {
    page.drawText(safe, { x: x + 6, y, size, font, color });
  } else {
    const textWidth = font.widthOfTextAtSize(safe, size);
    page.drawText(safe, { x: x + column.width - 6 - textWidth, y, size, font, color });
  }
}

function drawTableHeader(page: PDFPage, bold: PDFFont, y: number): number {
  const headerHeight = 20;
  page.drawRectangle({
    x: MARGIN,
    y: y - headerHeight,
    width: PAGE_WIDTH - MARGIN * 2,
    height: headerHeight,
    color: BLUSH,
  });
  ITEM_COLUMNS.forEach((column, index) => drawTableCell(page, bold, column.label, index, y - 14, 7.5, ROSE));
  return y - headerHeight - 6;
}

function itemExtraLines(
  regular: PDFFont,
  item: DocumentLineItem,
): string[] {
  const width = PAGE_WIDTH - MARGIN * 2 - 12;
  const lines: string[] = [];
  if (item.includedAccessories?.length) {
    lines.push(...wrap(`Included: ${item.includedAccessories.join(", ")}`, regular, 7.5, width));
  }
  if (item.units) {
    const unitsText = item.units.length
      ? `Assigned unit(s): ${item.units
          .map((unit) => `${unit.unitCode}${unit.serialNumber ? ` (SN ${unit.serialNumber})` : ""}`)
          .join(", ")}`
      : "Assigned unit(s): pending";
    lines.push(...wrap(unitsText, regular, 7.5, width));
  }
  return lines;
}

/** Product | Price/Day | Quantity | Rental Days | Line Total -- one row per line, paginating as needed. */
function drawItemsTable(
  pdf: PDFDocument,
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  items: DocumentLineItem[],
  y: number,
): { page: PDFPage; y: number } {
  let currentPage = page;
  let currentY = drawTableHeader(currentPage, bold, y);

  for (const item of items) {
    const nameLines = wrap(item.productName, regular, 8.5, ITEM_COLUMNS[0].width - 12);
    const extraLines = itemExtraLines(regular, item);
    const rowHeight = Math.max(1, nameLines.length) * 11 + extraLines.length * 10 + 14;

    if (currentY - rowHeight < ITEM_TABLE_BOTTOM_LIMIT) {
      currentPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      currentY = drawTableHeader(currentPage, bold, PAGE_HEIGHT - MARGIN);
    }

    const firstLineY = currentY - 13;
    drawTableCell(currentPage, regular, money(item.pricePerDay), 1, firstLineY, 8.5, INK);
    drawTableCell(currentPage, regular, `${item.quantity}`, 2, firstLineY, 8.5, INK);
    drawTableCell(currentPage, regular, `${item.rentalDays}`, 3, firstLineY, 8.5, INK);
    drawTableCell(currentPage, bold, money(item.lineTotal), 4, firstLineY, 8.5, INK);

    let lineY = firstLineY;
    for (const line of nameLines) {
      drawTableCell(currentPage, regular, line, 0, lineY, 8.5, INK);
      lineY -= 11;
    }
    for (const line of extraLines) {
      currentPage.drawText(safeText(line), { x: MARGIN + 6, y: lineY, size: 7.5, font: regular, color: MUTED });
      lineY -= 10;
    }

    currentY = lineY - 4;
    currentPage.drawLine({
      start: { x: MARGIN, y: currentY + 10 },
      end: { x: PAGE_WIDTH - MARGIN, y: currentY + 10 },
      thickness: 0.4,
      color: BORDER,
    });
  }

  return { page: currentPage, y: currentY - 4 };
}

function ensureSpace(
  pdf: PDFDocument,
  page: PDFPage,
  y: number,
  needed: number,
): { page: PDFPage; y: number } {
  if (y - needed >= 90) return { page, y };
  const newPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return { page: newPage, y: PAGE_HEIGHT - MARGIN };
}

export async function createInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = addBrandHeader(
    page,
    bold,
    input.isDemo ? "Demo Rental Invoice" : "Rental Invoice",
    input.invoiceNumber,
    input.isDemo,
  );
  y = drawSummary(page, regular, bold, input, y);
  ({ page, y } = drawItemsTable(pdf, page, regular, bold, input.items, y));
  ({ page, y } = ensureSpace(pdf, page, y, 170));

  const totalAmount = input.totalAmount ?? input.amount;
  const amountDueNow = input.amountDueNow ?? input.amount;
  const remainingBalance = input.remainingBalance ?? Math.max(0, totalAmount - amountDueNow);
  y = drawAmountBox(page, regular, bold, totalAmount, y, "Total rental amount", itemsCaption(input.items));
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
      : "This booking invoice is payable manually via GCash and verified by our team against the reservation.",
  );
  pdf.setTitle(`Invoice ${safeText(input.invoiceNumber)}`);
  pdf.setAuthor("Rental by Maddy & Cassy");
  return pdf.save();
}

export async function createReceiptPdf(input: ReceiptPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = addBrandHeader(
    page,
    bold,
    input.isDemo ? "Demo Payment Receipt" : "Official Payment Receipt",
    input.receiptNumber,
    input.isDemo,
  );
  y = drawSummary(page, regular, bold, input, y);
  ({ page, y } = drawItemsTable(pdf, page, regular, bold, input.items, y));
  ({ page, y } = ensureSpace(pdf, page, y, 170));

  y = drawAmountBox(page, regular, bold, input.amount, y, "Payment received", itemsCaption(input.items));
  y = drawField(
    page,
    regular,
    bold,
    input.isDemo ? "Demo transaction reference" : "GCash transaction reference",
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
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = addBrandHeader(
    page,
    bold,
    input.isDemo ? "Demo Rental Agreement" : "Rental Agreement",
    `Booking ${input.bookingRef}`,
    input.isDemo,
  );
  y = drawSummary(page, regular, bold, input, y);
  const half = (PAGE_WIDTH - MARGIN * 2 - 20) / 2;
  const phoneY = drawField(page, regular, bold, "Phone", input.phone, MARGIN, y, half);
  const addressY = drawField(
    page,
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
    page,
    regular,
    bold,
    "Handover method",
    input.fulfillmentMethod,
    MARGIN,
    y,
    half,
  );
  const locationY = drawField(
    page,
    regular,
    bold,
    "Location",
    input.customerLocation,
    MARGIN + half + 20,
    y,
    half,
  );
  y = Math.min(methodY, locationY);

  ({ page, y } = drawItemsTable(pdf, page, regular, bold, input.items, y));
  ({ page, y } = ensureSpace(pdf, page, y, 150));

  y = drawAmountBox(page, regular, bold, input.amount, y, "Reservation payment received", itemsCaption(input.items));
  drawField(page, regular, bold, "Payment confirmation", input.paymentReference, MARGIN, y, 270);
  drawField(page, regular, bold, "Reservation secured", input.confirmedAt, MARGIN + 310, y, 180);
  addFooter(
    page,
    regular,
    `${input.isDemo ? "DEMO FLOW TEST - " : ""}Agreement terms version ${input.termsVersion}`,
  );

  const pageTwo = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y2 = PAGE_HEIGHT - MARGIN;
  if (input.isDemo) {
    pageTwo.drawText("DEMO FLOW TEST - NOT A VALID PAYMENT RECORD", {
      x: PAGE_WIDTH - MARGIN - 225,
      y: y2,
      size: 7.5,
      font: bold,
      color: ROSE,
    });
    y2 -= 24;
  }
  pageTwo.drawText("RENTAL TERMS & CONDITIONS", {
    x: MARGIN,
    y: y2,
    size: 15,
    font: bold,
    color: ROSE,
  });
  y2 -= 31;

  const terms = [
    "Every rented item remains the property of Rental by Maddy & Cassy at all times.",
    "The customer agrees to return every item on or before the agreed return date and through the agreed pickup or delivery arrangement.",
    "The customer is responsible for reasonable care of each item and will use it only for its intended purpose.",
    "Late returns may result in additional charges communicated by the business.",
    "Damage, loss, or missing accessories will be assessed by the business. The customer agrees to cooperate in resolving the resulting costs.",
    "Payment is confirmed only through the verified GCash transaction shown in this agreement and its corresponding receipt.",
    "The customer authorizes the electronic signature below and agrees that it is binding for this booking and every item listed above.",
    "Personal information and verification documents are used only for identity verification, booking fulfillment, legal compliance, and legitimate business records.",
  ];

  terms.forEach((term, index) => {
    const lines = wrap(`${index + 1}. ${term}`, regular, 10.5, PAGE_WIDTH - MARGIN * 2);
    for (const line of lines) {
      pageTwo.drawText(line, { x: MARGIN, y: y2, size: 10.5, font: regular, color: INK });
      y2 -= 17;
    }
    y2 -= 9;
  });

  y2 -= 14;
  pageTwo.drawLine({
    start: { x: MARGIN, y: y2 },
    end: { x: PAGE_WIDTH - MARGIN, y: y2 },
    thickness: 0.7,
    color: BORDER,
  });
  y2 -= 29;
  pageTwo.drawText("CUSTOMER ELECTRONIC SIGNATURE", {
    x: MARGIN,
    y: y2,
    size: 9,
    font: bold,
    color: MUTED,
  });
  y2 -= 18;

  const signature = await embedSignature(pdf, input.signatureBytes, input.signatureContentType);
  if (signature) {
    const scale = Math.min(230 / signature.width, 80 / signature.height, 1);
    pageTwo.drawImage(signature, {
      x: MARGIN,
      y: y2 - signature.height * scale,
      width: signature.width * scale,
      height: signature.height * scale,
    });
  } else {
    pageTwo.drawText(safeText(input.typedFullName), {
      x: MARGIN,
      y: y2 - 34,
      size: 18,
      font: bold,
      color: INK,
    });
  }
  y2 -= 96;
  drawField(pageTwo, regular, bold, "Legally signed by", input.typedFullName, MARGIN, y2, half);
  drawField(pageTwo, regular, bold, "Signed at", input.signedAt, MARGIN + half + 20, y2, half);
  if (input.businessSignerName) {
    y2 -= 68;
    pageTwo.drawLine({
      start: { x: MARGIN, y: y2 },
      end: { x: PAGE_WIDTH - MARGIN, y: y2 },
      thickness: 0.7,
      color: BORDER,
    });
    y2 -= 27;
    pageTwo.drawText("BUSINESS COUNTERSIGNATURE", {
      x: MARGIN,
      y: y2,
      size: 9,
      font: bold,
      color: MUTED,
    });
    y2 -= 24;
    drawField(pageTwo, regular, bold, "Authorized business signer", input.businessSignerName, MARGIN, y2, half);
    drawField(pageTwo, regular, bold, "Countersigned at", input.businessSignedAt || input.confirmedAt, MARGIN + half + 20, y2, half);
  }
  addFooter(
    pageTwo,
    regular,
    `${input.isDemo ? "DEMO FLOW TEST - " : ""}Agreement terms version ${input.termsVersion} - Terms & Signatures`,
  );

  pdf.setTitle(`Signed Rental Agreement - ${safeText(input.bookingRef)}`);
  pdf.setSubject("Electronically signed rental agreement for a secured reservation");
  pdf.setAuthor("Rental by Maddy & Cassy");
  return pdf.save();
}
