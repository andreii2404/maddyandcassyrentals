import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Decision = "approved" | "rejected";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isDecision(value: unknown): value is Decision {
  return value === "approved" || value === "rejected";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    enforceRateLimit(request, "admin-booking-cancellation", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { bookingId } = await params;
    const body = (await request.json().catch(() => null)) as {
      requestId?: unknown;
      decision?: unknown;
      note?: unknown;
    } | null;

    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    const decision = body?.decision;
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!requestId || !isDecision(decision)) return errorResponse("Choose approve or reject for this cancellation request.", 400);
    if (note.length > 1000) return errorResponse("Administrator notes must be 1,000 characters or fewer.", 400);
    if (decision === "rejected" && note.length < 5) {
      return errorResponse("Add a short explanation when rejecting a cancellation request.", 400);
    }

    const { data: requestRecord, error: requestLookupError } = await supabase
      .from("booking_cancellation_requests")
      .select("booking_id")
      .eq("id", requestId)
      .maybeSingle();
    if (requestLookupError || !requestRecord) return errorResponse("The cancellation request no longer exists.", 404);
    if (requestRecord.booking_id !== bookingId) return errorResponse("The cancellation request does not belong to this booking.", 400);

    const { data, error } = await supabase.rpc("review_booking_cancellation", {
      p_request_id: requestId,
      p_decision: decision,
      p_decision_note: note || undefined,
    });

    if (error || !data) {
      const message = error?.message ?? "";
      if (message.includes("CANCELLATION_REQUEST_NOT_FOUND")) return errorResponse("The cancellation request no longer exists.", 404);
      if (message.includes("CANCELLATION_REQUEST_ALREADY_DECIDED")) return errorResponse("This cancellation request has already been decided.", 409);
      if (message.includes("BOOKING_STATUS_CHANGED")) return errorResponse("The booking changed before this request was reviewed. Refresh the page and try again.", 409);
      if (message.includes("DECISION_NOTE_TOO_LONG")) return errorResponse("Administrator notes must be 1,000 characters or fewer.", 400);
      console.error("Admin cancellation request review failed", { bookingId, error });
      return errorResponse("The cancellation request could not be reviewed. Please try again.", 500);
    }

    return NextResponse.json({
      success: true,
      bookingId,
      requestId: data.id,
      status: data.status,
    });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Admin cancellation request review failed", error);
    return errorResponse("The cancellation request could not be reviewed. Please try again.", 500);
  }
}
