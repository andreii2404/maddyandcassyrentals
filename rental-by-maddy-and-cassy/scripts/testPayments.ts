import assert from "node:assert/strict";
import test from "node:test";
import {
  createFinalAgreementPdf,
  createInvoicePdf,
  createReceiptPdf,
} from "../src/lib/pdf/customerDocuments";

test("generates invoice and receipt PDFs", async () => {
  const base = {
    bookingRef: "MC-20260729-TEST",
    customerName: "Test Customer",
    customerEmail: "customer@example.com",
    items: [{ productName: "Camera", pricePerDay: 1250, quantity: 1, rentalDays: 2, lineTotal: 2500 }],
    rentalDates: "July 29, 2026 - July 30, 2026",
    amount: 2500,
    issuedAt: "July 29, 2026",
  };
  const invoice = await createInvoicePdf({ ...base, invoiceNumber: "INV-TEST" });
  const receipt = await createReceiptPdf({
    ...base,
    receiptNumber: "OR-TEST",
    paymentReference: "pay_test",
    paymentMethod: "gcash",
  });
  const agreement = await createFinalAgreementPdf({
    ...base,
    items: [
      {
        productName: "Camera",
        pricePerDay: 1250,
        quantity: 1,
        rentalDays: 2,
        lineTotal: 2500,
        includedAccessories: ["Protective case"],
        units: [{ unitCode: "CAM-001", serialNumber: "SN12345" }],
      },
    ],
    address: "Sta. Cruz, Manila",
    phone: "+63 917 000 0000",
    fulfillmentMethod: "Pickup",
    customerLocation: "Sta. Cruz, Manila",
    termsVersion: "2026-01",
    signedAt: "July 29, 2026",
    typedFullName: "Test Customer",
    paymentReference: "pay_test",
    confirmedAt: "July 29, 2026",
    businessSignerName: "Maddy & Cassy Rentals",
    businessSignedAt: "July 29, 2026",
  });
  assert.equal(Buffer.from(invoice).subarray(0, 4).toString(), "%PDF");
  assert.equal(Buffer.from(receipt).subarray(0, 4).toString(), "%PDF");
  assert.equal(Buffer.from(agreement).subarray(0, 4).toString(), "%PDF");
});
