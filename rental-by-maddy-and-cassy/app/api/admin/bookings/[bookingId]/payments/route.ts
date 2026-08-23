import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { fulfillVerifiedPayment } from "@/src/lib/server/paymentFulfillment";
import { getBookingById } from "@/src/services/bookingService";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";

export const runtime = "nodejs";

const REVIEW_STATUSES = new Set(["verified", "rejected"]);

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-payment-record", 30, 60_000);
    const { user } = await requireActiveAdmin();
    const { bookingId } = await params;
    const body = (await request.json().catch(() => null)) as
      | {
          action?: unknown;
          method?: unknown;
          reference?: unknown;
          notes?: unknown;
          allowed?: unknown;
          note?: unknown;
        }
      | null;
    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);
    if (!booking) return NextResponse.json({ error: "The booking could not be found." }, { status: 404 });

    if (body?.action === "set_pay_later") {
      const allowed = body.allowed === true;
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (allowed && !note) {
        return NextResponse.json({ error: "Add a reason before allowing handover with a balance." }, { status: 400 });
      }
      if (note.length > 1000) {
        return NextResponse.json({ error: "The exception note must be 1,000 characters or fewer." }, { status: 400 });
      }

      const now = new Date().toISOString();
      const { error } = await admin.from("bookings").update({
        pay_later_allowed: allowed,
        pay_later_allowed_by: allowed ? user.id : null,
        pay_later_allowed_at: allowed ? now : null,
        pay_later_note: allowed ? note : null,
      }).eq("id", bookingId);
      if (error) throw new Error(error.message);

      await admin.from("booking_status_history").insert({
        booking_id: bookingId,
        from_status: booking.status,
        to_status: booking.status,
        note: allowed
          ? `Admin allowed handover before full payment: ${note}`
          : "Admin removed the handover-before-full-payment exception.",
        changed_by: user.id,
      });
      await admin.rpc("log_audit_event", {
        p_action: allowed ? "payment.pay_later_allowed" : "payment.pay_later_removed",
        p_entity_type: "booking",
        p_entity_id: bookingId,
        p_booking_id: bookingId,
        p_previous_values: { allowed: booking.payLaterAllowed },
        p_new_values: { allowed, note: allowed ? note : null },
      });
      return NextResponse.json({ success: true });
    }

    if (body?.action !== "record_in_person") {
      return NextResponse.json({ error: "Choose a valid payment action." }, { status: 400 });
    }

    const method = body.method === "cash" || body.method === "gcash_in_person" ? body.method : null;
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (!method) return NextResponse.json({ error: "Choose cash or in-person GCash." }, { status: 400 });
    if (reference.length > 120 || notes.length > 1000) {
      return NextResponse.json({ error: "The payment reference or notes are too long." }, { status: 400 });
    }
    if (["returned", "cancelled", "rejected"].includes(booking.status)) {
      return NextResponse.json({ error: "A payment cannot be recorded for this closed booking." }, { status: 409 });
    }

    const { data: paymentRows } = await admin
      .from("booking_payment_submissions")
      .select("declared_amount, status")
      .eq("booking_id", bookingId);
    if ((paymentRows ?? []).some((row) => row.status === "submitted" || row.status === "under_review")) {
      return NextResponse.json({ error: "Review the pending payment proof before recording another payment." }, { status: 409 });
    }
    const amountPaid = (paymentRows ?? [])
      .filter((row) => row.status === "verified")
      .reduce((sum, row) => sum + row.declared_amount, 0);
    const balanceDue = Math.max(0, booking.totalAmount - amountPaid);
    if (balanceDue <= 0.01) {
      return NextResponse.json({ error: "This booking is already fully paid." }, { status: 409 });
    }

    const paymentId = crypto.randomUUID();
    const paymentReference = reference || `INPERSON-${booking.bookingRef}-${paymentId.slice(0, 6).toUpperCase()}`;
    const { error: insertError } = await admin.from("booking_payment_submissions").insert({
      id: paymentId,
      booking_id: bookingId,
      stage: "balance",
      declared_amount: balanceDue,
      payment_method: method,
      external_reference: paymentReference,
      status: "submitted",
      currency_code: "PHP",
      provider_metadata: { channel: "in_person", recordedBy: user.id, notes },
    });
    if (insertError) throw new Error(insertError.message);

    await fulfillVerifiedPayment(admin, {
      paymentSubmissionId: paymentId,
      providerPaymentId: paymentReference,
      paymentMethod: method,
      providerMetadata: { channel: "in_person", recordedBy: user.id, notes },
    });
    await admin.from("booking_payment_submissions").update({ reviewed_by: user.id }).eq("id", paymentId);
    await admin.from("booking_status_history").insert({
      booking_id: bookingId,
      from_status: booking.status,
      to_status: booking.status,
      note: `Admin recorded an in-person ${method === "cash" ? "cash" : "GCash"} balance payment of PHP ${balanceDue.toLocaleString("en-PH")}.`,
      changed_by: user.id,
    });

    return NextResponse.json({ success: true, paymentId, amount: balanceDue });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("In-person payment action failed", error);
    return NextResponse.json({ error: "The payment action could not be completed." }, { status: 500 });
  }
}

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
          action_url: bookingTrackingPath(bookingId, booking.isGuestCheckout),
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
