import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isValidGcashReference, normalizeGcashReference } from "../src/lib/manualGcash";
import {
  createFinalAgreementPdf,
  createInvoicePdf,
  createReceiptPdf,
} from "../src/lib/pdf/customerDocuments";

test("validates and normalizes manual GCash references", () => {
  assert.equal(normalizeGcashReference(" 1234 5678 / abc "), "12345678abc");
  assert.equal(isValidGcashReference("12345678"), true);
  assert.equal(isValidGcashReference("GCASH-ABC-12345"), true);
  assert.equal(isValidGcashReference("short"), false);
  assert.equal(isValidGcashReference("reference_with_invalid_symbols"), false);
});

test("ships the official GCash QR as a usable PNG asset", async () => {
  const qr = await readFile("public/images/payment/gcash-qr.png");
  assert.equal(qr.subarray(1, 4).toString(), "PNG");
  assert.ok(qr.length > 10_000);
  assert.ok(qr.readUInt32BE(16) >= 500);
  assert.ok(qr.readUInt32BE(20) >= 500);
});

test("generates invoice and receipt PDFs", async () => {
  const base = {
    bookingRef: "MC-20260729-TEST",
    customerName: "Test Customer",
    customerEmail: "customer@example.com",
    productName: "Camera",
    items: [
      { productName: "Camera", quantity: 1, dailyRate: 500 },
      { productName: "iPhone", quantity: 2, dailyRate: 1200 },
    ],
    rentalDates: "July 29, 2026 - July 30, 2026",
    amount: 2500,
    issuedAt: "July 29, 2026",
  };
  const invoice = await createInvoicePdf({ ...base, invoiceNumber: "INV-TEST" });
  const receipt = await createReceiptPdf({
    ...base,
    receiptNumber: "OR-TEST",
    paymentReference: "GCASH-TEST-12345",
    paymentMethod: "GCash",
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
    paymentReference: "GCASH-TEST-12345",
    confirmedAt: "July 29, 2026",
    businessSignerName: "Maddy & Cassy Rentals",
    businessSignedAt: "July 29, 2026",
  });
  assert.equal(Buffer.from(invoice).subarray(0, 4).toString(), "%PDF");
  assert.equal(Buffer.from(receipt).subarray(0, 4).toString(), "%PDF");
  assert.equal(Buffer.from(agreement).subarray(0, 4).toString(), "%PDF");
});
