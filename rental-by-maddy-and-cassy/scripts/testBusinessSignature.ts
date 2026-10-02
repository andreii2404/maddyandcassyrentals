import assert from "node:assert/strict";
import test from "node:test";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import {
  businessSignatureStoragePath,
  decodeBusinessSignatureDataUrl,
} from "../src/lib/businessSignature";
import { createFinalAgreementPdf } from "../src/lib/pdf/customerDocuments";

// A valid 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

test("accepts a well-formed PNG signature data URL", () => {
  const bytes = decodeBusinessSignatureDataUrl(PNG_DATA_URL);
  assert.ok(bytes);
  assert.equal(bytes.length, Buffer.from(PNG_BASE64, "base64").length);
});

test("rejects anything that is not a PNG data URL", () => {
  assert.equal(decodeBusinessSignatureDataUrl(undefined), null);
  assert.equal(decodeBusinessSignatureDataUrl(""), null);
  assert.equal(decodeBusinessSignatureDataUrl(42), null);
  assert.equal(decodeBusinessSignatureDataUrl(PNG_BASE64), null);
  assert.equal(decodeBusinessSignatureDataUrl(`data:image/jpeg;base64,${PNG_BASE64}`), null);
  assert.equal(decodeBusinessSignatureDataUrl(`${PNG_DATA_URL}!!`), null);
});

test("rejects base64 that is not actually a PNG", () => {
  const notPng = Buffer.from("this is definitely not a png image file").toString("base64");
  assert.equal(decodeBusinessSignatureDataUrl(`data:image/png;base64,${notPng}`), null);
});

test("rejects a PNG with zero or oversized dimensions", () => {
  const zeroWidth = Buffer.from(PNG_BASE64, "base64");
  zeroWidth.writeUInt32BE(0, 16);
  assert.equal(
    decodeBusinessSignatureDataUrl(`data:image/png;base64,${zeroWidth.toString("base64")}`),
    null,
  );

  const huge = Buffer.from(PNG_BASE64, "base64");
  huge.writeUInt32BE(100_000, 16);
  assert.equal(
    decodeBusinessSignatureDataUrl(`data:image/png;base64,${huge.toString("base64")}`),
    null,
  );
});

test("rejects an oversized payload without decoding it", () => {
  const padding = "A".repeat(2_000_000);
  assert.equal(decodeBusinessSignatureDataUrl(`data:image/png;base64,${padding}`), null);
});

test("stores the signature under the admin's folder for the booking", () => {
  assert.equal(
    businessSignatureStoragePath("admin-1", "booking-1", 1700000000000),
    "admin-1/booking-1/business-signature/1700000000000-business-signature.png",
  );
});

const agreementInput = {
  bookingRef: "MC-TEST-SIGNATURES",
  customerName: "Test Customer",
  customerEmail: "customer@example.com",
  items: [{ productName: "Camera", pricePerDay: 1250, quantity: 1, rentalDays: 2, lineTotal: 2500 }],
  rentalDates: "July 29, 2026 - July 30, 2026",
  amount: 2500,
  issuedAt: "July 29, 2026",
  address: "Sta. Cruz, Manila",
  phone: "+63 917 000 0000",
  fulfillmentMethod: "Pickup",
  customerLocation: "Sta. Cruz, Manila",
  termsVersion: "2026-01",
  signedAt: "July 29, 2026",
  typedFullName: "Test Customer",
  paymentReference: "pay_test",
  confirmedAt: "July 29, 2026",
};

/** Images drawn on the terms & signatures page (soft masks are not page-level XObjects). */
async function countSignatureImages(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes);
  const resources = pdf.getPages()[1].node.Resources();
  const xObjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xObjects) return 0;
  return xObjects
    .keys()
    .filter((key) => {
      const object = xObjects.lookup(key);
      return (
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
      );
    }).length;
}

test("final agreement embeds both the customer and the business signature", async () => {
  const signature = decodeBusinessSignatureDataUrl(PNG_DATA_URL)!;
  const bytes = await createFinalAgreementPdf({
    ...agreementInput,
    signatureBytes: signature,
    signatureContentType: "image/png",
    businessSignerName: "Business Owner",
    businessSignatureBytes: signature,
    businessSignatureContentType: "image/png",
    businessSignedAt: "July 30, 2026",
  });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
  assert.equal(await countSignatureImages(bytes), 2);
});

test("final agreement without a business signature embeds only the customer's", async () => {
  const signature = decodeBusinessSignatureDataUrl(PNG_DATA_URL)!;
  const bytes = await createFinalAgreementPdf({
    ...agreementInput,
    signatureBytes: signature,
    signatureContentType: "image/png",
  });
  assert.equal(await countSignatureImages(bytes), 1);
});
