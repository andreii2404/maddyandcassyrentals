import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/src/lib/supabase/database.types";
import type { BookingReceipt, PaymentOption, PaymentRecord } from "@/src/types/payment";

export type { PaymentOption };

export interface ReservationResumeState {
  paymentState: "unpaid" | "pending" | "partially_paid" | "paid";
  isDemoPayment: boolean;
  receiptReady: boolean;
  booking: {
    id: string;
    bookingRef: string;
    productId: string;
    quantity: number;
    startDate: string;
    endDate: string;
    pickupConvenienceFee: number;
    fulfillmentMethod: "pickup" | "delivery";
    location: string | null;
    cityMunicipality: string | null;
    province: string | null;
    totalAmount: number;
    customerSnapshot: {
      fullName: string;
      email: string;
      phone: string;
      address: string;
      facebookLink: string;
      instagramLink: string;
    };
  };
}

export interface ManualPaymentSubmissionInput {
  referenceNumber: string;
  accountName: string;
  accountNumber: string;
  paymentOption: "deposit_50" | "full" | "balance";
  proofFile: File;
}

export async function submitManualPayment(
  bookingId: string,
  input: ManualPaymentSubmissionInput,
): Promise<{ paymentId: string }> {
  const formData = new FormData();
  formData.append("referenceNumber", input.referenceNumber);
  formData.append("accountName", input.accountName);
  formData.append("accountNumber", input.accountNumber);
  formData.append("paymentOption", input.paymentOption);
  formData.append("proof", input.proofFile);

  let response: Response;
  try {
    response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/payment/submit`, {
      method: "POST",
      credentials: "same-origin",
      body: formData,
    });
  } catch {
    throw new Error("The payment details could not reach the server. Check your connection and try again.");
  }
  const body = (await response.json().catch(() => null)) as
    | { paymentId?: unknown; error?: unknown }
    | null;
  if (!response.ok || typeof body?.paymentId !== "string") {
    throw new Error(typeof body?.error === "string" ? body.error : "The payment details could not be submitted.");
  }
  return { paymentId: body.paymentId };
}

export async function getReservationResumeState(
  bookingId: string,
): Promise<ReservationResumeState> {
  const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/resume`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (Partial<ReservationResumeState> & { error?: unknown })
    | null;

  if (!response.ok || !body?.booking || typeof body.booking.id !== "string") {
    throw new Error(
      typeof body?.error === "string" ? body.error : "This reservation could not be resumed.",
    );
  }
  return body as ReservationResumeState;
}

type PaymentSubmissionRow = Tables<"booking_payment_submissions"> & {
  customer_documents?: { storage_bucket: string; storage_path: string; original_filename: string | null } | null;
};

/** Shared row -> view-model mapping for public.booking_payment_submissions, reused by bookingDetailService.ts and adminReadService.ts. */
export function mapPaymentSubmission(row: PaymentSubmissionRow): PaymentRecord {
  return {
    id: row.id,
    bookingId: row.booking_id,
    stage: row.stage,
    amount: row.declared_amount,
    currency: "PHP",
    status: row.status,
    paymentMethod: row.payment_method ?? undefined,
    externalReference: row.external_reference ?? undefined,
    proofDocumentId: row.proof_document_id ?? undefined,
    proofStorageBucket: row.customer_documents?.storage_bucket ?? undefined,
    proofStoragePath: row.customer_documents?.storage_path ?? undefined,
    proofOriginalFilename: row.customer_documents?.original_filename ?? undefined,
    paymongoCheckoutSessionId: row.paymongo_checkout_session_id ?? undefined,
    paymongoPaymentId: row.paymongo_payment_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    providerMetadata: (row.provider_metadata as Record<string, unknown>) ?? {},
    reviewNotes: row.review_notes ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getBookingPayments(
  supabase: SupabaseClient<Database>,
  bookingId: string,
): Promise<PaymentRecord[]> {
  const { data, error } = await supabase
    .from("booking_payment_submissions")
    .select("*, customer_documents(storage_bucket, storage_path, original_filename)")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapPaymentSubmission(row as PaymentSubmissionRow));
}

/** Admin decision on a manually submitted GCash proof of payment. */
export async function reviewManualPayment(
  bookingId: string,
  paymentId: string,
  status: "verified" | "rejected",
  reason?: string,
): Promise<void> {
  const response = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/payments`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentId, status, reason }),
  });
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "The payment review could not be saved.");
  }
}

export async function getBookingReceipts(
  supabase: SupabaseClient<Database>,
  bookingId: string,
): Promise<BookingReceipt[]> {
  const { data, error } = await supabase
    .from("booking_receipts")
    .select("*")
    .eq("booking_id", bookingId)
    .order("issued_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(
    (row): BookingReceipt => ({
      id: row.id,
      bookingId: row.booking_id,
      paymentSubmissionId: row.payment_submission_id ?? undefined,
      receiptNumber: row.receipt_number,
      amount: row.amount,
      issuedAt: row.issued_at,
      documentPath: row.document_path ?? undefined,
      issuedBy: row.issued_by ?? undefined,
      createdAt: row.created_at,
    }),
  );
}
