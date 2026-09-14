import { NextResponse } from "next/server";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

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
    enforceRateLimit(request, "booking-document-resubmission", 12, 10 * 60_000);
    const { user } = await requireUser();
    const { bookingId } = await params;
    const submissionId = new URL(request.url).searchParams.get("submissionId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
      throw new RequestSecurityError("The document reference is invalid.", 400);
    }

    const value = (await request.formData()).get("file");
    if (!(value instanceof File) || value.size === 0) {
      throw new RequestSecurityError("Choose a replacement file to upload.", 400);
    }
    if (value.size > MAX_FILE_SIZE) {
      throw new RequestSecurityError("Each file must be 4MB or smaller.", 400);
    }
    if (!ALLOWED_CONTENT_TYPES.has(value.type)) {
      throw new RequestSecurityError("The selected file type is not supported.", 400);
    }

    const admin = createAdminClient();
    const { data: submission, error: submissionError } = await admin
      .from("booking_requirement_submissions")
      .select("id, booking_requirement_id, review_status, attempt_number, booking_requirements(id, booking_id), customer_documents(document_type, owner_user_id)")
      .eq("id", submissionId)
      .maybeSingle();
    if (submissionError) throw new Error(submissionError.message);

    const requirement = submission?.booking_requirements;
    const document = submission?.customer_documents;
    if (
      !submission ||
      requirement?.booking_id !== bookingId ||
      submission.review_status !== "rejected" ||
      document?.owner_user_id !== user.id
    ) {
      return errorResponse("Only a rejected document from this booking can be resubmitted.", 409);
    }

    const { data: latestSubmission, error: latestSubmissionError } = await admin
      .from("booking_requirement_submissions")
      .select("id")
      .eq("booking_requirement_id", submission.booking_requirement_id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestSubmissionError) throw new Error(latestSubmissionError.message);
    if (latestSubmission?.id !== submissionId) {
      return errorResponse("This document has already been resubmitted and is awaiting review.", 409);
    }

    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("id, status, is_guest_checkout")
      .eq("id", bookingId)
      .eq("customer_id", user.id)
      .maybeSingle();
    if (bookingError) throw new Error(bookingError.message);
    if (!booking) return errorResponse("The booking could not be found.", 404);

    const newSubmissionId = crypto.randomUUID();
    const storagePath = `${user.id}/${bookingId}/replacement-${newSubmissionId}.${extensionFor(value.type)}`;
    const { error: uploadError } = await admin.storage.from("booking-documents").upload(storagePath, value, {
      contentType: value.type,
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: replacement, error: documentError } = await admin
      .from("customer_documents")
      .insert({
        owner_user_id: user.id,
        document_type: document.document_type,
        storage_bucket: "booking-documents",
        storage_path: storagePath,
        original_filename: value.name || "replacement-document",
        mime_type: value.type,
        file_size_bytes: value.size,
        status: "active",
      })
      .select("id")
      .single();
    if (documentError || !replacement) throw new Error(documentError?.message ?? "The replacement document could not be recorded.");

    const now = new Date().toISOString();
    const { error: replacementError } = await admin.from("booking_requirement_submissions").insert({
      id: newSubmissionId,
      booking_requirement_id: submission.booking_requirement_id,
      customer_document_id: replacement.id,
      attempt_number: (submission.attempt_number ?? 1) + 1,
      review_status: "pending",
      submitted_at: now,
    });
    if (replacementError) throw new Error(replacementError.message);

    const { error: requirementError } = await admin
      .from("booking_requirements")
      .update({ status: "pending_review" })
      .eq("id", submission.booking_requirement_id);
    if (requirementError) throw new Error(requirementError.message);

    const { error: bookingUpdateError } = await admin
      .from("bookings")
      .update({ updated_at: now })
      .eq("id", bookingId);
    if (bookingUpdateError) throw new Error(bookingUpdateError.message);

    const { data: adminUsers, error: adminUsersError } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (adminUsersError) throw new Error(adminUsersError.message);

    const adminNotifications = (adminUsers ?? []).map(({ user_id: adminUserId }) => ({
      admin_user_id: adminUserId,
      booking_id: bookingId,
      notification_type: "document_resubmitted",
      title: "Document resubmitted — needs review",
      message: `A customer resubmitted their ${document.document_type.replace(/_/g, " ")}. Review the latest upload before taking action.`,
      action_url: `/admin/bookings/${bookingId}#requirements-review-heading`,
    }));

    await Promise.all([
      admin.from("booking_status_history").insert({
        booking_id: bookingId,
        from_status: booking.status,
        to_status: booking.status,
        note: `Customer resubmitted ${document.document_type.replace(/_/g, " ")} for review.`,
        changed_by: user.id,
      }),
      admin.from("notifications").insert({
        user_id: user.id,
        booking_id: bookingId,
        notification_type: "requirements_reviewed",
        title: "Replacement document submitted",
        message: `Your ${document.document_type.replace(/_/g, " ")} replacement is pending review.`,
        action_url: bookingTrackingPath(bookingId, booking.is_guest_checkout === true),
      }),
      adminNotifications.length > 0
        ? admin.from("admin_notifications").insert(adminNotifications)
        : Promise.resolve({ error: null }),
      admin.rpc("log_audit_event", {
        p_action: "verification.document_resubmitted",
        p_entity_type: "requirement_submission",
        p_entity_id: newSubmissionId,
        p_booking_id: bookingId,
        p_new_values: { previousSubmissionId: submissionId, documentType: document.document_type },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Document resubmission failed", error);
    return errorResponse("The replacement document could not be submitted.", 500);
  }
}
