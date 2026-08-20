import { NextResponse } from "next/server";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { getBookingById } from "@/src/services/bookingService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel Functions accept request bodies up to 4.5 MB. Keep individual files
// below that ceiling so multipart form-data overhead cannot make uploads fail
// only after deployment.
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ID_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const SIGNATURE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UPLOAD_KINDS = {
  idOne: { fileName: "id-one", signature: false },
  idTwo: { fileName: "id-two", signature: false },
  selfie: { fileName: "selfie", signature: false },
  emergencyId: { fileName: "emergency-contact-id", signature: false },
  signature: { fileName: "signature", signature: true },
} as const;

type UploadKind = keyof typeof UPLOAD_KINDS;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "application/pdf") return "pdf";
  return "jpg";
}

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "booking-document-upload", 30, 10 * 60_000);
    const { supabase, user } = await requireUser();
    const { bookingId } = await params;
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") as UploadKind | null;
    const submissionId = url.searchParams.get("submissionId") ?? "";
    if (!kind || !(kind in UPLOAD_KINDS)) {
      throw new RequestSecurityError("The document type is invalid.", 400);
    }
    if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
      throw new RequestSecurityError("The upload session is invalid.", 400);
    }

    const booking = await getBookingById(supabase, bookingId);
    if (!booking) return errorResponse("The booking could not be found.", 404);
    if (booking.customerId !== user.id) return errorResponse("You do not have access to this booking.", 403);
    if (booking.requirementsStatus !== "not_submitted") {
      return errorResponse("Verification documents have already been submitted.", 409);
    }

    // Manual GCash payments never reach "verified" until an admin reviews
    // them (see docs/PRODUCTION.md payment flow). Gate on the customer having
    // submitted payment proof at all, not on admin verification -- that
    // happens later and must not block the rest of the booking flow.
    const { data: submittedPayment } = await supabase
      .from("booking_payment_submissions")
      .select("id")
      .eq("booking_id", bookingId)
      .in("status", ["submitted", "under_review", "verified"])
      .limit(1)
      .maybeSingle();
    if (!submittedPayment) {
      return errorResponse("Submit your reservation payment proof before uploading documents.", 409);
    }

    const formData = await request.formData();
    const value = formData.get("file");
    if (!(value instanceof File) || value.size === 0) {
      throw new RequestSecurityError("Choose a file to upload.", 400);
    }
    if (value.size > MAX_FILE_SIZE) {
      throw new RequestSecurityError("Each file must be 4MB or smaller.", 400);
    }
    const uploadKind = UPLOAD_KINDS[kind];
    const allowedTypes = uploadKind.signature ? SIGNATURE_CONTENT_TYPES : ID_CONTENT_TYPES;
    if (!allowedTypes.has(value.type)) {
      throw new RequestSecurityError("The selected file type is not supported.", 400);
    }

    const bucket = uploadKind.signature ? "customer-documents" : "booking-documents";
    const path = `${user.id}/${bookingId}/${uploadKind.fileName}-${submissionId}.${extensionFor(value.type)}`;

    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, value, {
      contentType: value.type,
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    return NextResponse.json({ success: true, path, bucket });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Private booking document upload failed", error);
    return errorResponse("This file could not be securely uploaded.", 500);
  }
}
