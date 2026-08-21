import { NextResponse } from "next/server";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";
import type { Database } from "@/src/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const PROOF_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

type PaymentStage = Database["public"]["Enums"]["payment_stage"];

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "application/pdf") return "pdf";
  return "jpg";
}

function isPaymentOption(value: unknown): value is "deposit_50" | "full" | "balance" {
  return value === "deposit_50" || value === "full" || value === "balance";
}

/** payment_stage has no direct "deposit_50"/"full" concept -- down_payment covers
 * the 50% reservation option, balance covers paying off a remaining balance, and
 * a single full payment (no prior deposit) doesn't fit either bucket cleanly, so
 * it's recorded as "other". */
function paymentOptionToStage(option: "deposit_50" | "full" | "balance"): PaymentStage {
  if (option === "deposit_50") return "down_payment";
  if (option === "balance") return "balance";
  return "other";
}

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "manual-payment-submit", 8, 10 * 60_000);
    const { user } = await requireUser();
    const { bookingId } = await params;
    const admin = createAdminClient();

    const booking = await getBookingById(admin, bookingId);
    if (!booking) return errorResponse("The booking could not be found.", 404);
    if (booking.customerId !== user.id) return errorResponse("You do not have access to this booking.", 403);
    if (!["pending", "approved", "confirmed", "ready_for_release", "released"].includes(booking.status)) {
      return errorResponse("Payment is not available for this booking.", 409);
    }

    const formData = await request.formData();
    const referenceNumber = String(formData.get("referenceNumber") ?? "").trim();
    const accountName = String(formData.get("accountName") ?? "").trim();
    const accountNumber = String(formData.get("accountNumber") ?? "").trim();
    const paymentOptionRaw = formData.get("paymentOption");
    const proof = formData.get("proof");

    if (!referenceNumber || referenceNumber.length > 120) {
      throw new RequestSecurityError("Enter a valid GCash reference number.", 400);
    }
    if (!accountName || accountName.length > 160) {
      throw new RequestSecurityError("Enter the name of the account used to pay.", 400);
    }
    if (!accountNumber || accountNumber.length > 40) {
      throw new RequestSecurityError("Enter the mobile number or account number used to pay.", 400);
    }
    if (!isPaymentOption(paymentOptionRaw)) {
      throw new RequestSecurityError("Choose a valid payment option.", 400);
    }
    if (!(proof instanceof File) || proof.size === 0) {
      throw new RequestSecurityError("Upload a screenshot or proof of payment.", 400);
    }
    if (proof.size > MAX_FILE_SIZE) {
      throw new RequestSecurityError("The proof of payment must be 4MB or smaller.", 400);
    }
    if (!PROOF_CONTENT_TYPES.has(proof.type)) {
      throw new RequestSecurityError("The selected file type is not supported.", 400);
    }

    const stage = paymentOptionToStage(paymentOptionRaw);

    const { data: priorPayments } = await admin
      .from("booking_payment_submissions")
      .select("declared_amount, status")
      .eq("booking_id", bookingId)
      .eq("status", "verified");
    const amountPaid = (priorPayments ?? []).reduce((sum, row) => sum + row.declared_amount, 0);

    const balanceDue = Math.max(0, booking.totalAmount - amountPaid);
    if (balanceDue <= 0) return errorResponse("This booking is already paid.", 409);

    const amount =
      paymentOptionRaw === "deposit_50" && amountPaid === 0
        ? Math.round(booking.totalAmount * 50) / 100
        : balanceDue;

    const submissionId = crypto.randomUUID();
    const path = `${user.id}/${bookingId}/proof-${submissionId}.${extensionFor(proof.type)}`;

    const { error: uploadError } = await admin.storage.from("payment-proofs").upload(path, proof, {
      contentType: proof.type,
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: customerDocument, error: documentError } = await admin
      .from("customer_documents")
      .insert({
        owner_user_id: user.id,
        document_type: "payment_proof",
        storage_bucket: "payment-proofs",
        storage_path: path,
        original_filename: proof.name || "proof-of-payment",
        mime_type: proof.type,
        file_size_bytes: proof.size,
        status: "active",
      })
      .select("id")
      .single();
    if (documentError || !customerDocument) {
      throw new Error(documentError?.message ?? "The proof of payment could not be recorded.");
    }

    const { error: submissionError } = await admin.from("booking_payment_submissions").insert({
      id: submissionId,
      booking_id: bookingId,
      stage,
      declared_amount: amount,
      payment_method: "gcash",
      external_reference: referenceNumber,
      proof_document_id: customerDocument.id,
      status: "submitted",
      currency_code: "PHP",
      provider_metadata: { accountName, accountNumber },
    });
    if (submissionError) throw new Error(submissionError.message);

    await admin.from("booking_status_history").insert({
      booking_id: bookingId,
      from_status: booking.status,
      to_status: booking.status,
      note: `Customer submitted a GCash payment proof (ref ${referenceNumber}) for admin review.`,
      changed_by: user.id,
    });

    await admin.rpc("log_audit_event", {
      p_action: "payment.proof_submitted",
      p_entity_type: "payment_submission",
      p_entity_id: submissionId,
      p_booking_id: bookingId,
      p_new_values: { amount, stage, referenceNumber },
    });

    return NextResponse.json({ success: true, paymentId: submissionId });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Manual payment submission failed", error);
    return errorResponse("The payment details could not be submitted. Please try again.", 500);
  }
}
