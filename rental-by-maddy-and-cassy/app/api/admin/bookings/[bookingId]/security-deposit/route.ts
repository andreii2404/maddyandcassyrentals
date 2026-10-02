import { NextResponse } from "next/server";
import { cleanText, isUuid, parseIsoDate } from "@/src/lib/fulfillmentApiHelpers";
import { validateSecurityDepositInput } from "@/src/lib/rentalFulfillment";
import { jsonError, routeFailureResponse, rpcErrorResponse } from "@/src/lib/server/adminRouteErrors";
import { enforceRateLimit, requireActiveAdmin } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The security deposit could not be saved. Please try again.";

/** Records the security deposit as paid. The amount is fixed by the database, never sent. */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-security-deposit", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;
    if (!isUuid(bookingId)) return jsonError("The selected booking could not be found.", 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const method = body?.method;
    const referenceNumber = cleanText(body?.referenceNumber, 120);
    const problem = validateSecurityDepositInput({ method, referenceNumber });
    if (problem) return jsonError(problem, 400);

    const paidAt = parseIsoDate(body?.paidAt);
    if (!paidAt) return jsonError("Enter a valid date and time.", 400);

    const { error } = await supabase.rpc("admin_record_security_deposit", {
      p_booking_id: bookingId,
      p_method: method as string,
      p_reference_number: method === "cash" ? "" : referenceNumber,
      p_paid_at: paidAt,
    });
    if (error) return rpcErrorResponse(error, FAILURE, "Admin security deposit update failed");
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeFailureResponse(error, FAILURE, "Admin security deposit update failed");
  }
}
