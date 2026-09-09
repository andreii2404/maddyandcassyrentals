import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { sendReceiptEmail, type ReceiptEmailAttachment } from "@/src/lib/server/receiptEmail";

export const runtime = "nodejs";

const isDev = process.env.NODE_ENV !== "production";

function errorResponse(message: string, status: number, detail?: string) {
  // In production the customer-facing message stays generic; outside production we
  // append the underlying reason so the actual failure is visible while developing.
  const body = isDev && detail ? { error: `${message} (dev detail: ${detail})` } : { error: message };
  return NextResponse.json(body, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "admin-receipt-email", 20, 60_000);
    const { user } = await requireActiveAdmin();
    const { bookingId } = await params;
    const admin = createAdminClient();

    const body = (await request.json().catch(() => null)) as { receiptId?: unknown } | null;
    const receiptId = typeof body?.receiptId === "string" ? body.receiptId : "";
    if (!receiptId) return errorResponse("Choose a valid receipt to email.", 400);

    const booking = await getBookingById(admin, bookingId);
    if (!booking) return errorResponse("The booking could not be found.", 404);

    const { data: receipt } = await admin
      .from("booking_receipts")
      .select("*")
      .eq("id", receiptId)
      .maybeSingle();
    if (!receipt || receipt.booking_id !== bookingId) {
      return errorResponse("The receipt could not be found.", 404);
    }
    if (!receipt.document_path) {
      return errorResponse("This receipt has no PDF to send yet.", 409);
    }

    if (receipt.payment_submission_id) {
      const { data: paymentRow } = await admin
        .from("booking_payment_submissions")
        .select("status")
        .eq("id", receipt.payment_submission_id)
        .maybeSingle();
      if (paymentRow && paymentRow.status !== "verified") {
        return errorResponse("The payment for this receipt is no longer verified.", 409);
      }
    }

    let customerEmail = booking.customerSnapshot.email?.trim() ?? "";
    let emailSource = "booking snapshot";
    if (!customerEmail) {
      const { data: profile } = await admin
        .from("profiles")
        .select("contact_email")
        .eq("id", booking.customerId)
        .maybeSingle();
      customerEmail = profile?.contact_email?.trim() ?? "";
      emailSource = "profiles.contact_email";
      if (!customerEmail) {
        const { data: authUser } = await admin.auth.admin.getUserById(booking.customerId);
        customerEmail = authUser.user?.email?.trim() ?? "";
        emailSource = "auth user record";
      }
    }
    if (!customerEmail) {
      return errorResponse("No email address is on file for this customer.", 400);
    }
    if (isDev) {
      console.info("Receipt email: resolved recipient", { bookingId, emailSource, customerEmail });
    }

    let attachment: ReceiptEmailAttachment | null = null;
    const { data: pdfBlob, error: pdfError } = await admin.storage
      .from("receipts")
      .download(receipt.document_path);
    if (pdfBlob) {
      const bytes = Buffer.from(await pdfBlob.arrayBuffer());
      attachment = { filename: `${receipt.receipt_number}.pdf`, content: bytes.toString("base64") };
    } else {
      // Not fatal: the email still links to the live receipt via bookingUrl. Log so the
      // missing attachment is visible instead of silently shipping a link-only email.
      console.error("Receipt email: could not download receipt PDF, sending link-only email", {
        bookingId,
        documentPath: receipt.document_path,
        error: pdfError?.message ?? "unknown storage error",
      });
    }

    const emailResult = await sendReceiptEmail(customerEmail, {
      bookingReference: booking.bookingRef,
      customerName: booking.customerSnapshot.fullName || "Customer",
      amountPaid: receipt.amount,
      receiptNumber: receipt.receipt_number,
      startDate: booking.startDate,
      endDate: booking.endDate,
      bookingUrl: `${new URL(request.url).origin}${bookingTrackingPath(bookingId, booking.isGuestCheckout)}`,
      isGuest: booking.isGuestCheckout,
      receiptAttached: attachment !== null,
    }, attachment);

    if (!emailResult.sent) {
      console.error("Receipt email send failed", {
        bookingId,
        receiptId,
        reason: emailResult.reason,
        detail: emailResult.detail,
      });
      if (emailResult.reason === "not_configured") {
        return errorResponse(
          "Add the booking email settings (RESEND_API_KEY, BOOKING_EMAIL_FROM) to send receipt emails.",
          503,
          emailResult.detail,
        );
      }
      if (emailResult.reason === "invalid_recipient") {
        return errorResponse("The customer's email address on file is not valid.", 400, emailResult.detail);
      }
      return errorResponse(
        "The receipt email could not be delivered. Please try again.",
        502,
        emailResult.detail,
      );
    }

    const now = new Date().toISOString();
    await admin
      .from("booking_receipts")
      .update({ emailed_at: now, emailed_to: customerEmail })
      .eq("id", receiptId);

    await admin.rpc("log_audit_event", {
      p_action: "payment.receipt_emailed",
      p_entity_type: "booking_receipt",
      p_entity_id: receiptId,
      p_booking_id: bookingId,
      p_new_values: { emailedTo: customerEmail, receiptNumber: receipt.receipt_number, reviewedBy: user.id },
    });

    await admin.from("notifications").insert({
      user_id: booking.customerId,
      booking_id: bookingId,
      notification_type: "receipt_emailed",
      title: "Receipt emailed",
      message: `Your official receipt for ${booking.bookingRef} was emailed to ${customerEmail}.`,
      action_url: bookingTrackingPath(bookingId, booking.isGuestCheckout),
    });

    return NextResponse.json({ success: true, emailedAt: now, emailedTo: customerEmail });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return errorResponse(error.message, error.status);
    }
    console.error("Receipt email action failed", error);
    return errorResponse(
      "The receipt email could not be sent.",
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
}
