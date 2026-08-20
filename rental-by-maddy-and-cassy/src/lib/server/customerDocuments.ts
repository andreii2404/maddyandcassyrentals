import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";
import type { StorageBucket } from "@/src/lib/supabase/storage";
import {
  createFinalAgreementPdf,
  createInvoicePdf,
  createReceiptPdf,
} from "@/src/lib/pdf/customerDocuments";
import type { Booking } from "@/src/types/booking";
import type { AgreementDoc } from "@/src/types/booking";

export function formatManilaDate(value: string | Date, withTime = false): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function bookingRentalDates(booking: Booking): string {
  return `${formatManilaDate(booking.startDate)} - ${formatManilaDate(booking.endDate)} (${booking.dayCount} day(s))`;
}

export async function savePrivatePdf(
  admin: SupabaseClient<Database>,
  bucket: StorageBucket,
  storagePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const { error } = await admin.storage.from(bucket).upload(storagePath, Buffer.from(bytes), {
    contentType: "application/pdf",
    upsert: true,
    cacheControl: "0",
  });
  if (error) throw new Error(`Failed to store ${storagePath}: ${error.message}`);
}

export async function generateAndSaveInvoice(
  admin: SupabaseClient<Database>,
  input: {
    booking: Booking;
    invoiceNumber: string;
    storagePath: string;
    amountDueNow: number;
    totalAmount: number;
    remainingBalance: number;
    paymentLabel: string;
  },
): Promise<void> {
  const { booking } = input;
  const bytes = await createInvoicePdf({
    invoiceNumber: input.invoiceNumber,
    bookingRef: booking.bookingRef,
    customerName: booking.customerSnapshot.fullName || "Customer",
    customerEmail: booking.customerSnapshot.email || "",
    productName: booking.productSnapshot.name || "Rental item",
    rentalDates: bookingRentalDates(booking),
    amount: input.amountDueNow,
    totalAmount: input.totalAmount,
    amountDueNow: input.amountDueNow,
    remainingBalance: input.remainingBalance,
    paymentLabel: input.paymentLabel,
    issuedAt: formatManilaDate(new Date(), true),
  });
  await savePrivatePdf(admin, "invoices", input.storagePath, bytes);
}

export async function generateAndSaveReceipt(
  admin: SupabaseClient<Database>,
  input: {
    booking: Booking;
    receiptNumber: string;
    paymentReference: string;
    paymentMethod: string;
    storagePath: string;
    amount: number;
  },
): Promise<void> {
  const { booking } = input;
  const bytes = await createReceiptPdf({
    receiptNumber: input.receiptNumber,
    bookingRef: booking.bookingRef,
    customerName: booking.customerSnapshot.fullName || "Customer",
    customerEmail: booking.customerSnapshot.email || "",
    productName: booking.productSnapshot.name || "Rental item",
    rentalDates: bookingRentalDates(booking),
    amount: input.amount,
    issuedAt: formatManilaDate(new Date(), true),
    paymentReference: input.paymentReference,
    paymentMethod: input.paymentMethod || "GCash",
  });
  await savePrivatePdf(admin, "receipts", input.storagePath, bytes);
}

export async function generateAndSaveFinalAgreement(
  admin: SupabaseClient<Database>,
  input: {
    booking: Booking;
    agreement: AgreementDoc;
    paymentReference: string;
    storagePath: string;
  },
): Promise<void> {
  const { booking, agreement } = input;
  const customerSignature = agreement.signatures?.find((s) => s.signerRole === "customer");
  const businessSignature = agreement.signatures?.find((s) => s.signerRole === "business");

  let signatureBytes: Uint8Array | undefined;
  let signatureContentType: string | undefined;
  if (customerSignature?.signaturePath) {
    const { data } = await admin.storage
      .from("customer-documents")
      .download(customerSignature.signaturePath);
    if (data) {
      signatureBytes = new Uint8Array(await data.arrayBuffer());
      signatureContentType = data.type;
    }
  }

  const bytes = await createFinalAgreementPdf({
    bookingRef: booking.bookingRef,
    customerName: booking.customerSnapshot.fullName || customerSignature?.signerName || "Customer",
    customerEmail: booking.customerSnapshot.email || "",
    phone: booking.customerSnapshot.phone || "",
    address: booking.customerSnapshot.address || "",
    productName: booking.productSnapshot.name || "Rental item",
    rentalDates: bookingRentalDates(booking),
    amount: booking.totalAmount,
    issuedAt: formatManilaDate(new Date(), true),
    fulfillmentMethod: booking.fulfillmentMethod,
    customerLocation: booking.location || "",
    includedAccessories: booking.productSnapshot.included ?? [],
    termsVersion: agreement.versionNumber ? `v${agreement.versionNumber}` : "2026-01",
    signedAt: customerSignature ? formatManilaDate(customerSignature.signedAt, true) : "",
    typedFullName: customerSignature?.signerName || booking.customerSnapshot.fullName || "Customer",
    signatureBytes,
    signatureContentType,
    paymentReference: input.paymentReference,
    confirmedAt: formatManilaDate(new Date(), true),
    businessSignerName: businessSignature?.signerName,
    businessSignedAt: businessSignature ? formatManilaDate(businessSignature.signedAt, true) : undefined,
  });
  await savePrivatePdf(admin, "agreements", input.storagePath, bytes);
}
