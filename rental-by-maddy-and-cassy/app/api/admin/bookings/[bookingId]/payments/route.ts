import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { fulfillVerifiedPayment } from "@/src/lib/server/paymentFulfillment";
import { getBookingById } from "@/src/services/bookingService";

export const runtime = "nodejs";

const REVIEW_STATUSES = new Set(["verified", "rejected"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-payment-review", 60, 60_000);
    const { user } = await requireActiveAdmin();
    const { bookingId } = await params;
    const admin = createAdminClient();

    const body = (await request.json().catch(() => null)) as
      | { paymentId?: unknown; status?: unknown; reason?: unknown }
      | null;
    const paymentId = typeof body?.paymentId === "string" ? body.paymentId : "";
    const rawStatus = body?.status;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!paymentId || typeof rawStatus !== "string" || !REVIEW_STATUSES.has(rawStatus)) {
      return NextResponse.json({ error: "Choose a valid payment review action." }, { status: 400 });
    }
    const status = rawStatus as "verified" | "rejected";
    if (status === "rejected" && !reason) {
      return NextResponse.json({ error: "Add a reason for the rejection." }, { status: 400 });
    }
    if (reason.length > 1000) {
      return NextResponse.json({ error: "Review notes must be 1,000 characters or fewer." }, { status: 400 });
    }

    const { data: submission } = await admin
      .from("booking_payment_submissions")
      .select("id, booking_id, status, declared_amount, payment_method, external_reference")
      .eq("id", paymentId)
      .maybeSingle();
    if (!submission || submission.booking_id !== bookingId) {
      return NextResponse.json({ error: "The payment submission could not be found." }, { status: 404 });
    }
    if (!["submitted", "under_review"].includes(submission.status)) {
      return NextResponse.json({ error: "This payment has already been reviewed." }, { status: 409 });
    }

    if (status === "verified") {
      // Runs every side effect a verified payment needs: marks it verified,
      // issues the receipt PDF, and auto-confirms the booking + finalizes the
      // agreement if every other gate already cleared. Shared with the legacy
      // PayMongo webhook path so manual GCash review gets identical fulfillment.
      const result = await fulfillVerifiedPayment(admin, {
        paymentSubmissionId: paymentId,
        providerPaymentId: submission.external_reference || paymentId,
        paymentMethod: submission.payment_method || "gcash",
        providerMetadata: { manualReview: true, reviewedBy: user.id },
      });
      await admin
        .from("booking_payment_submissions")
        .update({ reviewed_by: user.id })
        .eq("id", paymentId);

      const booking = await getBookingById(admin, bookingId);
      await admin.from("booking_status_history").insert({
        booking_id: bookingId,
        from_status: booking?.status ?? "pending",
        to_status: booking?.status ?? "pending",
        note: `Admin verified a GCash payment of PHP ${submission.declared_amount.toLocaleString("en-PH")}.${result.bookingConfirmed ? " Booking auto-confirmed." : ""}`,
        changed_by: user.id,
      });
    } else {
      const now = new Date().toISOString();
      const { error: updateError } = await admin
        .from("booking_payment_submissions")
        .update({
          status: "rejected",
          review_notes: reason,
          reviewed_by: user.id,
          reviewed_at: now,
        })
        .eq("id", paymentId);
      if (updateError) throw new Error(updateError.message);

      const booking = await getBookingById(admin, bookingId);
      await admin.from("booking_status_history").insert({
        booking_id: bookingId,
        from_status: booking?.status ?? "pending",
        to_status: booking?.status ?? "pending",
        note: `Admin rejected a submitted payment proof: ${reason}`,
        changed_by: user.id,
      });

      if (booking?.customerId) {
        await admin.from("notifications").insert({
          user_id: booking.customerId,
          booking_id: bookingId,
          notification_type: "payment_reviewed",
          title: "Payment proof rejected",
          message: reason,
          action_url: `/account/bookings/${bookingId}`,
        });
      }

      await admin.rpc("log_audit_event", {
        p_action: "payment.reviewed",
        p_entity_type: "payment_submission",
        p_entity_id: paymentId,
        p_booking_id: bookingId,
        p_new_values: { status, reason },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Payment review failed", error);
    return NextResponse.json({ error: "The payment review could not be saved." }, { status: 500 });
  }
}
