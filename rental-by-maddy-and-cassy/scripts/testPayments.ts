import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyPayMongoSignature } from "../src/lib/paymongo/webhook";
import {
  buildPaymentReturnUrl,
  safePaymentReturnPath,
} from "../src/lib/paymongo/returnUrl";
import {
  createFinalAgreementPdf,
  createInvoicePdf,
  createReceiptPdf,
} from "../src/lib/pdf/customerDocuments";

process.env.PAYMONGO_WEBHOOK_SECRET = "whsk_unit_test";

test("accepts a valid PayMongo timestamped signature", () => {
  const raw = JSON.stringify({ data: { id: "evt_test" } });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", process.env.PAYMONGO_WEBHOOK_SECRET!)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  assert.doesNotThrow(() =>
    verifyPayMongoSignature(raw, `t=${timestamp},te=${signature},li=`),
  );
});

test("rejects a tampered PayMongo webhook", () => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  assert.throws(() =>
    verifyPayMongoSignature('{"tampered":true}', `t=${timestamp},te=bad,li=`),
  );
});

test("returns PayMongo to the exact hostname that started checkout", () => {
  assert.equal(
    buildPaymentReturnUrl(
      "https://maddyandcassyrentals-nine.vercel.app/api/payments/checkout",
      "/catalog/product-1/reserve?bookingId=booking-1",
      "success",
    ),
    "https://maddyandcassyrentals-nine.vercel.app/catalog/product-1/reserve?bookingId=booking-1&payment=success",
  );
  assert.equal(
    buildPaymentReturnUrl(
      "http://localhost:3000/api/payments/checkout",
      "/account/bookings/booking-1",
      "cancelled",
    ),
    "http://localhost:3000/account/bookings/booking-1?payment=cancelled",
  );
  assert.equal(safePaymentReturnPath("https://malicious.example", "/account/bookings"), "/account/bookings");
  assert.equal(safePaymentReturnPath("//malicious.example", "/account/bookings"), "/account/bookings");
});

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
