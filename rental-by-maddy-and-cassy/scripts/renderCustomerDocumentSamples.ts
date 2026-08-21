import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createFinalAgreementPdf,
  createInvoicePdf,
  createReceiptPdf,
} from "../src/lib/pdf/customerDocuments";

const outputDirectory = resolve("output", "pdf");

async function main() {
  await mkdir(outputDirectory, { recursive: true });

  const base = {
    bookingRef: "MC-20260730-DEMO",
    customerName: "Sample Customer",
    customerEmail: "customer@example.com",
    items: [
      { productName: "Fujifilm Instax Mini 12", pricePerDay: 625, quantity: 1, rentalDays: 2, lineTotal: 1250 },
      { productName: "Ring Light 18-inch", pricePerDay: 300, quantity: 2, rentalDays: 2, lineTotal: 1200 },
    ],
    rentalDates: "July 30, 2026 - July 31, 2026 (2 days)",
    amount: 1250,
    issuedAt: "July 30, 2026, 3:30 PM",
  };
  const invoiceInput = {
    ...base,
    invoiceNumber: "INV-MC-20260730-DEMO",
    totalAmount: 2500,
    amountDueNow: 1250,
    remainingBalance: 1250,
    paymentLabel: "50% reservation payment",
  };
  const receiptInput = {
    ...base,
    receiptNumber: "OR-MC-20260730-DEMO",
    paymentReference: "pay_demo_verified",
    paymentMethod: "GCash",
  };
  const agreementInput = {
    ...base,
    items: [
      {
        productName: "Fujifilm Instax Mini 12",
        pricePerDay: 625,
        quantity: 1,
        rentalDays: 2,
        lineTotal: 1250,
        includedAccessories: ["Protective case", "Wrist strap", "USB charging cable"],
        units: [{ unitCode: "INSTAX-001", serialNumber: "SN-778812" }],
      },
      {
        productName: "Ring Light 18-inch",
        pricePerDay: 300,
        quantity: 2,
        rentalDays: 2,
        lineTotal: 1200,
        includedAccessories: ["Tripod stand", "Phone clip"],
        units: [
          { unitCode: "RING-004", serialNumber: null },
          { unitCode: "RING-005", serialNumber: null },
        ],
      },
    ],
    address: "Sta. Cruz, Manila",
    phone: "+63 917 000 0000",
    fulfillmentMethod: "Pickup",
    customerLocation: "Sta. Cruz, Manila",
    termsVersion: "2026-01",
    signedAt: "July 30, 2026, 3:35 PM",
    typedFullName: "Sample Customer",
    paymentReference: "pay_demo_verified",
    confirmedAt: "July 30, 2026, 3:31 PM",
  };

  await Promise.all([
    writeFile(
      resolve(outputDirectory, "sample-booking-invoice.pdf"),
      await createInvoicePdf(invoiceInput),
    ),
    writeFile(
      resolve(outputDirectory, "sample-payment-receipt.pdf"),
      await createReceiptPdf(receiptInput),
    ),
    writeFile(
      resolve(outputDirectory, "sample-signed-rental-agreement.pdf"),
      await createFinalAgreementPdf(agreementInput),
    ),
    writeFile(
      resolve(outputDirectory, "sample-demo-booking-invoice.pdf"),
      await createInvoicePdf({ ...invoiceInput, isDemo: true }),
    ),
    writeFile(
      resolve(outputDirectory, "sample-demo-payment-receipt.pdf"),
      await createReceiptPdf({
        ...receiptInput,
        paymentReference: "DEMO-TEST-REFERENCE",
        paymentMethod: "Demo GCash",
        isDemo: true,
      }),
    ),
    writeFile(
      resolve(outputDirectory, "sample-demo-signed-rental-agreement.pdf"),
      await createFinalAgreementPdf({
        ...agreementInput,
        paymentReference: "DEMO-TEST-REFERENCE",
        isDemo: true,
      }),
    ),
  ]);

  console.log(outputDirectory);
}

void main();
