import type { Database } from "@/src/lib/supabase/database.types";
import type { BookingStatus } from "@/src/types/booking";

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

/** Who actually approved/rejected a payment proof, chosen explicitly by the reviewing admin. */
export type PaymentReviewerName = "Maddy" | "Cassy";

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
  /** Display name of the admin named in reviewedBy, resolved via a profiles lookup where available. */
  reviewedByName?: string;
  /** Explicitly chosen Maddy/Cassy approver or rejecter; takes precedence over reviewedByName when set. */
  reviewerName?: PaymentReviewerName;
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
  bookingStatus: BookingStatus;
  /** Display name of the admin named in reviewedBy, resolved server-side. */
  reviewedByName?: string;
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
