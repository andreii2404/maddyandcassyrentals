import { NextResponse } from "next/server";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";
import type { BalancePaymentPreference } from "@/src/types/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPreference(value: unknown): value is BalancePaymentPreference {
  return value === "online_gcash" || value === "in_person";
}

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "balance-payment-preference", 20, 60_000);
    const { user } = await requireUser();
    const { bookingId } = await params;
    const body = (await request.json().catch(() => null)) as { preference?: unknown } | null;
    if (!isPreference(body?.preference)) {
      return NextResponse.json({ error: "Choose a valid balance payment option." }, { status: 400 });
    }

    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);
    if (!booking) return NextResponse.json({ error: "The booking could not be found." }, { status: 404 });
    if (booking.customerId !== user.id) {
      return NextResponse.json({ error: "You do not have access to this booking." }, { status: 403 });
    }
    if (["returned", "cancelled", "rejected"].includes(booking.status)) {
      return NextResponse.json({ error: "The balance option can no longer be changed for this booking." }, { status: 409 });
    }

    const updatedAt = new Date().toISOString();
    const { error } = await admin
      .from("bookings")
      .update({
        balance_payment_preference: body.preference,
        balance_preference_updated_at: updatedAt,
      })
      .eq("id", bookingId)
      .eq("customer_id", user.id);
    if (error) throw new Error(error.message);

    await admin.from("booking_status_history").insert({
      booking_id: bookingId,
      from_status: booking.status,
      to_status: booking.status,
      note: body.preference === "in_person"
        ? "Customer chose to settle the remaining balance in person."
        : "Customer chose to settle the remaining balance online through GCash.",
      changed_by: user.id,
    });

    await admin.rpc("log_audit_event", {
      p_action: "payment.balance_preference_updated",
      p_entity_type: "booking",
      p_entity_id: bookingId,
      p_booking_id: bookingId,
      p_previous_values: { preference: booking.balancePaymentPreference },
      p_new_values: { preference: body.preference },
    });

    return NextResponse.json({ success: true, preference: body.preference, updatedAt });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Balance payment preference update failed", error);
    return NextResponse.json({ error: "The balance payment option could not be saved." }, { status: 500 });
  }
}
