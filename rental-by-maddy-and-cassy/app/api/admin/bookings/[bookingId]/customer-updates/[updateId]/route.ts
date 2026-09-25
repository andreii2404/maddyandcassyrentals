import { NextResponse } from "next/server";
import { isUuid } from "@/src/lib/fulfillmentApiHelpers";
import { deliverCustomerUpdate } from "@/src/lib/server/customerUpdateEmail";
import { jsonError, routeFailureResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The message could not be sent. Please try again.";

/** Resends a saved customer update that has not been delivered. Reuses the same row. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookingId: string; updateId: string }> },
) {
  try {
    enforceRateLimit(request, "admin-customer-update-resend", 10, 60_000);
    await requireActiveAdmin();
    const { bookingId, updateId } = await params;
    if (!isUuid(bookingId) || !isUuid(updateId)) return jsonError("That message could not be found.", 404);

    const admin = createAdminClient();
    const { data: update } = await admin
      .from("booking_customer_updates")
      .select("id")
      .eq("id", updateId)
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (!update) return jsonError("That message could not be found.", 404);

    const outcome = await deliverCustomerUpdate({ updateId, origin: new URL(request.url).origin });
    if (outcome.reason === "already_sent") return jsonError("That message was already sent.", 409);
    if (outcome.reason === "invalid_recipient") {
      return jsonError("The customer does not have a valid email address on this booking.", 422);
    }
    return NextResponse.json({ success: true, delivered: outcome.delivered, emailedTo: outcome.emailedTo });
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin customer update resend failed");
  }
}
