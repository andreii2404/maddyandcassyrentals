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
    productName: "Camera",
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
    address: "Sta. Cruz, Manila",
    phone: "+63 917 000 0000",
    fulfillmentMethod: "Pickup",
    customerLocation: "Sta. Cruz, Manila",
    includedAccessories: ["Protective case"],
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
