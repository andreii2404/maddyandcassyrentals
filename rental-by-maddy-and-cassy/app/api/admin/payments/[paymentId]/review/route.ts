import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { fulfillVerifiedPayment } from "@/src/lib/server/paymentFulfillment";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-manual-payment-review", 30, 10 * 60_000);
    const { supabase, user } = await requireActiveAdmin();
    const { paymentId } = await params;
    const body = (await request.json().catch(() => null)) as
      | { action?: unknown; notes?: unknown }
      | null;
    const action = String(body?.action ?? "");
    const notes = String(body?.notes ?? "").trim().slice(0, 500);
    if (!/^[0-9a-f-]{36}$/i.test(paymentId)) {
      throw new RequestSecurityError("The payment submission is invalid.", 400);
    }
    if (!new Set(["verify", "reject"]).has(action)) {
      throw new RequestSecurityError("Choose Verify or Reject.", 400);
    }

    const { data: payment, error } = await supabase
      .from("booking_payment_submissions")
      .select("*")
      .eq("id", paymentId)
      .single();
    if (error || !payment) return errorResponse("The payment submission could not be found.", 404);
    if (!payment.proof_document_id) return errorResponse("This is not a manual payment proof.", 409);
    if (!["submitted", "under_review"].includes(payment.status)) {
      return errorResponse("This payment submission has already been reviewed.", 409);
    }

    if (action === "reject") {
      if (notes.length < 5) {
        throw new RequestSecurityError("Add a clear rejection reason for the customer.", 400);
      }
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("booking_payment_submissions")
        .update({
          status: "rejected",
          review_notes: notes,
          reviewed_by: user.id,
          reviewed_at: now,
        })
        .eq("id", payment.id);
      if (updateError) throw new Error(updateError.message);
      await supabase.from("notifications").insert({
        user_id: (await supabase.from("bookings").select("customer_id").eq("id", payment.booking_id).single()).data?.customer_id ?? user.id,
        booking_id: payment.booking_id,
        notification_type: "payment_rejected",
        title: "GCash proof needs correction",
        message: notes,
        action_url: `/account/bookings/${payment.booking_id}`,
      });
      return NextResponse.json({ success: true, status: "rejected" });
    }

    const result = await fulfillVerifiedPayment(createAdminClient(), {
      paymentSubmissionId: payment.id,
      externalReference: payment.external_reference ?? payment.id,
      paymentMethod: "GCash",
      providerStatus: "manually_verified",
      providerMetadata: { manual: true, verifiedBy: user.id, reviewNotes: notes },
      reviewedBy: user.id,
    });
    return NextResponse.json({ success: true, status: "verified", ...result });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Manual GCash payment review failed", error);
    return errorResponse("The payment review could not be completed.", 500);
  }
}
