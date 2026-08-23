import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { getBookingById } from "@/src/services/bookingService";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";

export const runtime = "nodejs";

const REVIEW_STATUSES = new Set(["approved", "rejected"]);

// There is no more booking_documents/requirement_document_reviews table: a
// "documentId" here is a booking_requirement_submissions.id — see
// mapRequirementToDocument in bookingDetailService.ts, which is what
// RequirementsReviewPanel.tsx renders these ids from.
export async function PATCH(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-document-review", 60, 60_000);
    const { supabase, user } = await requireActiveAdmin();
    const { bookingId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { documentId?: unknown; status?: unknown; reason?: unknown }
      | null;
    const documentId = typeof body?.documentId === "string" ? body.documentId : "";
    const rawStatus = body?.status;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!documentId || typeof rawStatus !== "string" || !REVIEW_STATUSES.has(rawStatus)) {
      return NextResponse.json({ error: "Choose a valid document review action." }, { status: 400 });
    }
    const status = rawStatus as "approved" | "rejected";
    if (status === "rejected" && !reason) {
      return NextResponse.json({ error: "Add a reason for the rejection." }, { status: 400 });
    }
    if (reason.length > 1000) {
      return NextResponse.json({ error: "Review notes must be 1,000 characters or fewer." }, { status: 400 });
    }

    const { data: submission } = await supabase
      .from("booking_requirement_submissions")
      .select(
        "id, review_status, booking_requirement_id, booking_requirements(id, booking_id), customer_documents(document_type, owner_user_id)",
      )
      .eq("id", documentId)
      .maybeSingle();
    if (!submission || submission.booking_requirements?.booking_id !== bookingId) {
      return NextResponse.json({ error: "The document could not be found." }, { status: 404 });
    }

    const now = new Date().toISOString();
    await supabase
      .from("booking_requirement_submissions")
      .update({
        review_status: status,
        review_notes: reason || null,
        reviewed_by: user.id,
        reviewed_at: now,
      })
      .eq("id", documentId);

    await supabase.from("document_review_events").insert({
      submission_id: documentId,
      from_status: submission.review_status,
      to_status: status,
      notes: reason || null,
      reviewed_by: user.id,
    });

    await supabase
      .from("booking_requirements")
      .update({ status })
      .eq("id", submission.booking_requirement_id);

    const booking = await getBookingById(supabase, bookingId);
    const requirementsStatus = booking?.requirementsStatus ?? "pending_review";

    const documentType = submission.customer_documents?.document_type ?? "document";
    const ownerUserId = submission.customer_documents?.owner_user_id;
    const verifiesIdentity = ["government_id", "secondary_id"].includes(documentType);
    const birthdayVerified = Boolean(
      status === "approved" &&
      verifiesIdentity &&
      booking &&
      booking.birthdayDiscountAmount > 0 &&
      booking.birthdayDiscountStatus === "pending_verification" &&
      ownerUserId,
    );

    if (birthdayVerified && booking && ownerUserId) {
      await Promise.all([
        supabase
          .from("bookings")
          .update({ birthday_discount_status: "verified" })
          .eq("id", bookingId)
          .eq("birthday_discount_status", "pending_verification"),
        supabase
          .from("profiles")
          .update({ birth_date_verified_at: now, birth_date_verified_by: user.id })
          .eq("id", ownerUserId)
          .eq("birth_date", booking.birthDateSnapshot ?? ""),
      ]);
    }

    if (ownerUserId) {
      await supabase.from("notifications").insert({
        user_id: ownerUserId,
        booking_id: bookingId,
        notification_type: "requirements_reviewed",
        title: status === "approved" ? "Verification document approved" : "Document replacement requested",
        message: status === "approved"
          ? `Your ${documentType.replace(/_/g, " ")} was approved.${birthdayVerified ? " Your birthday-month discount is now verified." : ""}`
          : reason,
        action_url: bookingTrackingPath(bookingId, booking?.isGuestCheckout === true),
      });
    }

    await supabase.rpc("log_audit_event", {
      p_action: "verification.document_reviewed",
      p_entity_type: "requirement_submission",
      p_entity_id: documentId,
      p_booking_id: bookingId,
      p_new_values: { status, reason, birthdayVerified },
    });

    return NextResponse.json({ success: true, requirementsStatus });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Requirement review failed", error);
    return NextResponse.json({ error: "The document review could not be saved." }, { status: 500 });
  }
}
