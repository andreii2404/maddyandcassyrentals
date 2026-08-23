import type { Database } from "@/src/lib/supabase/database.types";

// Mirrors public.booking_payment_submissions / public.booking_receipts /
// public.paymongo_webhook_events. The 2026-08-04 schema normalization dropped
// payment_records, booking_invoices, invoice_line_items, and payment_event_logs
// outright — there is no invoice concept anymore, and audit_logs
// (entity_type = 'payment_submission') is the closest equivalent to the old
// payment_event_logs table.

export type PaymentSubmissionStatus = Database["public"]["Enums"]["payment_submission_status"];
export type PaymentStage = Database["public"]["Enums"]["payment_stage"];

/**
 * Client-facing checkout choice offered on the reservation/payment flow.
 * Mapped to a payment_stage value server-side — see paymentOptionToStage()
 * in app/api/bookings/[bookingId]/payment/submit/route.ts.
 */
export type PaymentOption = "deposit_50" | "full" | "balance";

/** One row of public.booking_payment_submissions. */
export interface PaymentRecord {
  id: string;
  bookingId: string;
  stage: PaymentStage;
  amount: number;
  currency: "PHP";
  status: PaymentSubmissionStatus;
  paymentMethod?: string;
  externalReference?: string;
  proofDocumentId?: string;
  proofStorageBucket?: string;
  proofStoragePath?: string;
  proofOriginalFilename?: string;
  paymongoCheckoutSessionId?: string;
  paymongoPaymentId?: string;
  idempotencyKey?: string;
  providerMetadata: Record<string, unknown>;
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  submittedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** PaymentRecord enriched with booking/customer context, for the admin Payment Records list. */
export interface AdminPaymentRecord extends PaymentRecord {
  bookingRef: string;
  customerName: string;
  isGuestCheckout: boolean;
}

/** One row of public.booking_receipts. */
export interface BookingReceipt {
  id: string;
  bookingId: string;
  paymentSubmissionId?: string;
  receiptNumber: string;
  amount: number;
  issuedAt: string;
  documentPath?: string;
  issuedBy?: string;
  emailedAt?: string;
  emailedTo?: string;
  createdAt: string;
}

/** One row of public.paymongo_webhook_events. */
export interface PayMongoWebhookEvent {
  id: string;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  signatureValid: boolean;
  processingStatus: "pending" | "processed" | "ignored" | "failed";
  errorMessage?: string;
  paymentSubmissionId?: string;
  receivedAt: string;
  processedAt?: string;
}
