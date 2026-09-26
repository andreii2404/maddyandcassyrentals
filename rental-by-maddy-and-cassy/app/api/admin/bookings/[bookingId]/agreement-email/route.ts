import { NextResponse } from "next/server";
import { buildSupabaseEmailRequest, DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME } from "@/src/lib/emailFunctionTransport";
import { buildSignedAgreementQueueRow } from "@/src/lib/emailNotificationQueue";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAILURE = "The signed agreement email could not be sent. Please try again.";

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-booking-agreement-email", 10, 60_000);
    await requireActiveAdmin();
    const { bookingId } = await params;
    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);

    if (!booking) return errorResponse("The selected booking could not be found.", 404);

    const { data: agreement, error: agreementError } = await admin
      .from("booking_agreements")
      .select("id, status")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (agreementError) throw agreementError;
    if (!agreement || agreement.status !== "completed") {
      return errorResponse("The signed agreement is not ready yet.", 409);
    }

    const { data: version, error: versionError } = await admin
      .from("agreement_versions")
      .select("final_document_path")
      .eq("agreement_id", agreement.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!version?.final_document_path) {
      return errorResponse("The signed agreement PDF is not available yet.", 409);
    }

    let recipientEmail = booking.customerSnapshot.email.trim();
    if (!recipientEmail) {
      const { data: authUser } = await admin.auth.admin.getUserById(booking.customerId);
      recipientEmail = authUser.user?.email?.trim() ?? "";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return errorResponse("The customer does not have a valid email address on this booking.", 422);
    }

    const subject = `Booking ${booking.bookingRef} confirmation & signed contract`;
    const queueRow = buildSignedAgreementQueueRow({
      bookingId,
      recipientEmail,
      recipientName: booking.customerSnapshot.fullName,
      subject,
    });
    const queueClient = admin as unknown as {
      from(table: string): {
        insert(row: typeof queueRow): Promise<{ error: { message?: string } | null }>;
      };
    };
    const { error: queueError } = await queueClient.from("email_notifications").insert(queueRow);
    if (queueError) throw queueError;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim();
    const functionName = process.env.SUPABASE_EMAIL_FUNCTION_NAME?.trim() || DEFAULT_SUPABASE_EMAIL_FUNCTION_NAME;
    if (!supabaseUrl || !serviceKey) return errorResponse(FAILURE, 502);

    const edgeRequest = buildSupabaseEmailRequest(
      { supabaseUrl, serviceKey, functionName },
      { to: recipientEmail, subject, html: "", text: "" },
    );
    const edgeResponse = await fetch(edgeRequest.url, edgeRequest.init);
    const payload = (await edgeResponse.json().catch(() => null)) as { success?: unknown; message?: unknown; error?: unknown } | null;
    if (!edgeResponse.ok || payload?.success !== true || payload.message === "No pending emails.") {
      console.error("Signed agreement email function failed", {
        bookingId,
        status: edgeResponse.status,
        message: payload?.message,
        error: payload?.error,
      });
      return errorResponse(FAILURE, 502);
    }

    return NextResponse.json({ success: true, emailedTo: recipientEmail });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Signed agreement email failed", error);
    return errorResponse(FAILURE, 500);
  }
}
