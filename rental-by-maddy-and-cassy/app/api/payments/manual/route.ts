import { NextResponse } from "next/server";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { getBookingById } from "@/src/services/bookingService";
import { toJson } from "@/src/lib/supabase/types";
import { isValidGcashReference } from "@/src/lib/manualGcash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROOF_SIZE = 4 * 1024 * 1024;
const ALLOWED_PROOF_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const OPTIONS = new Set(["deposit_50", "full", "balance"]);

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "application/pdf") return "pdf";
  return "jpg";
}

export async function POST(request: Request): Promise<NextResponse> {
  let uploadedPath: string | null = null;
  try {
    enforceRateLimit(request, "manual-gcash-payment", 8, 10 * 60_000);
    const { supabase, user } = await requireUser();
    const formData = await request.formData();
    const bookingId = String(formData.get("bookingId") ?? "");
    const paymentOption = String(formData.get("paymentOption") ?? "");
    const referenceNumber = String(formData.get("referenceNumber") ?? "").trim();
    const proof = formData.get("proof");

    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
      throw new RequestSecurityError("The booking reference is invalid.", 400);
    }
    if (!OPTIONS.has(paymentOption)) {
      throw new RequestSecurityError("Choose a valid payment option.", 400);
    }
    if (!isValidGcashReference(referenceNumber)) {
      throw new RequestSecurityError("Enter the 8–24 character GCash reference number shown on your receipt.", 400);
    }
    if (!(proof instanceof File) || proof.size === 0) {
      throw new RequestSecurityError("Upload the GCash payment confirmation screenshot or PDF.", 400);
    }
    if (proof.size > MAX_PROOF_SIZE) {
      throw new RequestSecurityError("The payment proof must be 4MB or smaller.", 400);
    }
    if (!ALLOWED_PROOF_TYPES.has(proof.type)) {
      throw new RequestSecurityError("Use a JPG, PNG, WEBP, or PDF payment proof.", 400);
    }

    const booking = await getBookingById(supabase, bookingId);
    if (!booking) return errorResponse("The booking could not be found.", 404);
    if (booking.customerId !== user.id) return errorResponse("You do not have access to this booking.", 403);
    if (!["pending", "approved", "confirmed"].includes(booking.status)) {
      return errorResponse("This booking can no longer accept a payment submission.", 409);
    }

    const { data: payments, error: paymentsError } = await supabase
      .from("booking_payment_submissions")
      .select("declared_amount,status,stage")
      .eq("booking_id", bookingId);
    if (paymentsError) throw new Error(paymentsError.message);
    if ((payments ?? []).some((payment) => ["submitted", "under_review"].includes(payment.status))) {
      return errorResponse("A GCash payment proof is already awaiting review for this booking.", 409);
    }

    const verifiedAmount = (payments ?? [])
      .filter((payment) => payment.status === "verified")
      .reduce((sum, payment) => sum + Number(payment.declared_amount), 0);
    const balance = Math.max(0, booking.totalAmount - verifiedAmount);
    if (balance <= 0.01) return errorResponse("This booking is already fully paid.", 409);

    const isFirstPayment = verifiedAmount <= 0.01;
    const stage = isFirstPayment
      ? paymentOption === "deposit_50" ? "down_payment" : "other"
      : "balance";
    const amount = isFirstPayment && paymentOption === "deposit_50"
      ? Math.round(booking.totalAmount * 50) / 100
      : balance;

    const proofId = crypto.randomUUID();
    uploadedPath = `${user.id}/${bookingId}/gcash-${proofId}.${extensionFor(proof.type)}`;
    const { error: uploadError } = await supabase.storage
      .from("payment-proofs")
      .upload(uploadedPath, proof, { contentType: proof.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: document, error: documentError } = await supabase
      .from("customer_documents")
      .insert({
        id: proofId,
        owner_user_id: user.id,
        document_type: "payment_proof",
        storage_bucket: "payment-proofs",
        storage_path: uploadedPath,
        original_filename: proof.name,
        mime_type: proof.type,
        file_size_bytes: proof.size,
      })
      .select("id")
      .single();
    if (documentError || !document) throw new Error(documentError?.message ?? "PAYMENT_PROOF_RECORD_FAILED");

    const { data: payment, error: paymentError } = await supabase
      .from("booking_payment_submissions")
      .insert({
        booking_id: bookingId,
        stage,
        declared_amount: amount,
        currency_code: "PHP",
        status: "under_review",
        payment_method: "GCash",
        external_reference: referenceNumber,
        proof_document_id: document.id,
        idempotency_key: `gcash:${bookingId}:${referenceNumber}`,
        provider_metadata: toJson({ manual: true, channel: "gcash", paymentOption }),
      })
      .select("id,status")
      .single();
    if (paymentError || !payment) {
      if (paymentError?.code === "23505") {
        return errorResponse("This GCash reference number has already been submitted.", 409);
      }
      throw new Error(paymentError?.message ?? "PAYMENT_SUBMISSION_FAILED");
    }

    await supabase.from("notifications").insert({
      user_id: user.id,
      booking_id: bookingId,
      notification_type: "payment_submitted",
      title: "GCash proof submitted",
      message: `Your ${stage === "down_payment" ? "50% reservation payment" : stage === "balance" ? "remaining balance" : "full payment"} proof for ${booking.bookingRef} is awaiting admin verification.`,
      action_url: `/account/bookings/${bookingId}`,
    });

    return NextResponse.json({
      success: true,
      paymentSubmissionId: payment.id,
      status: "under_review",
    });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Manual GCash payment submission failed", error);
    return errorResponse("Your GCash payment proof could not be securely submitted.", 500);
  }
}
