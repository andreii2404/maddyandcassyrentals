import { NextResponse } from "next/server";
import { cleanText, isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { deliverCustomerUpdate } from "@/src/lib/server/customerUpdateEmail";
import { jsonError, routeFailureResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The message could not be sent. Please try again.";
const ALLOWED_STATUSES = ["approved", "confirmed", "ready_for_release", "released", "returned"];

/**
 * Saves a customer update, then emails it. The update is kept even when the email fails, so the
 * admin can resend the same message from the history without creating a second record.
 */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-customer-update", 10, 60_000);
    const { user } = await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const subject = cleanText(body?.subject, 150);
    const message = cleanText(body?.message, 5000);
    const adminNote = cleanText(body?.adminNote, 1000);
    if (!subject) return jsonError("Add a subject for the message.", 400);
    if (!message) return jsonError("Write a message before sending.", 400);

    const admin = createAdminClient();
    const { data: booking } = await admin.from("bookings").select("id, status").eq("id", bookingId).maybeSingle();
    if (!booking) return jsonError("The selected booking could not be found.", 404);
    if (!ALLOWED_STATUSES.includes(booking.status)) {
      return jsonError("Customer updates are available after the booking is approved.", 409);
    }

    let relatedChargeId: string | null = null;
    if (body?.relatedChargeId !== undefined && body.relatedChargeId !== null) {
      if (!isUuid(body.relatedChargeId)) return jsonError("That charge could not be found.", 404);
      const { data: charge } = await admin
        .from("booking_charges")
        .select("id")
        .eq("id", body.relatedChargeId)
        .eq("booking_id", bookingId)
        .maybeSingle();
      if (!charge) return jsonError("That charge could not be found.", 404);
      relatedChargeId = charge.id;
    }

    const { data: created, error } = await admin
      .from("booking_customer_updates")
      .insert({
        booking_id: bookingId,
        subject,
        message,
        admin_note: adminNote || null,
        related_charge_id: relatedChargeId,
        sent_by: user.id,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("Customer update could not be saved", error);
      return jsonError(FAILURE, 500);
    }

    const outcome = await deliverCustomerUpdate({ updateId: created.id, origin: new URL(request.url).origin });
    return NextResponse.json({
      success: true,
      updateId: created.id,
      delivered: outcome.delivered,
      emailedTo: outcome.emailedTo,
    });
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin customer update failed");
  }
}
