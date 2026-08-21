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

export async function submitManualGcashPayment(input: {
  bookingId: string;
  paymentOption: PaymentOption;
  referenceNumber: string;
  proofFile: File;
}): Promise<{ paymentSubmissionId: string; status: "under_review" }> {
  const formData = new FormData();
  formData.append("bookingId", input.bookingId);
  formData.append("paymentOption", input.paymentOption);
  formData.append("referenceNumber", input.referenceNumber.trim());
  formData.append("proof", input.proofFile);

  const response = await fetch("/api/payments/manual", {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });
  const body = (await response.json().catch(() => null)) as
    | { paymentSubmissionId?: unknown; status?: unknown; error?: unknown }
    | null;
  if (
    !response.ok ||
    typeof body?.paymentSubmissionId !== "string" ||
    body.status !== "under_review"
  ) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "Your GCash payment proof could not be submitted.",
    );
  }
  return {
    paymentSubmissionId: body.paymentSubmissionId,
    status: "under_review",
  };
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

/** Shared row -> view-model mapping for public.booking_payment_submissions, reused by bookingDetailService.ts and adminReadService.ts. */
export function mapPaymentSubmission(row: Tables<"booking_payment_submissions">): PaymentRecord {
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
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapPaymentSubmission);
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
