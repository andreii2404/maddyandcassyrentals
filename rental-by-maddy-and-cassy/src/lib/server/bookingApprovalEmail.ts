import "server-only";

import { buildApprovalEmailDetails } from "@/src/lib/bookingApprovalEmailDetails";
import {
  isBookingEmailConfigured,
  missingBookingEmailSettings,
  sendBookingStatusEmail,
  type BookingStatusEmailResult,
} from "@/src/lib/server/bookingStatusEmail";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";

// Statuses a booking passes through after approval. The confirmation email can be
// re-sent while the booking is still in any of them.
const APPROVED_BOOKING_STATUSES = new Set(["approved", "confirmed", "ready_for_release", "released"]);

export interface BookingApprovalEmailOutcome {
  sent: boolean;
  emailedTo?: string;
  providerId?: string;
  contractFileName?: string;
  reason?: NonNullable<BookingStatusEmailResult["reason"]> | "not_found" | "not_approved" | "not_ready" | "load_failed";
}

interface SendBookingApprovalEmailOptions {
  bookingId: string;
  origin: string;
  /**
   * A manual re-send gets its own delivery key so the email provider does not
   * silently de-duplicate it against the original send.
   */
  resend?: boolean;
}

/**
 * Sends the Approval Confirmation email for a booking to the email saved on it
 * (guest checkout included). Never throws: the booking approval is already saved by
 * the time this runs, so every failure is logged server-side and returned as an
 * outcome for the caller to turn into a friendly message.
 */
export async function sendBookingApprovalEmail({
  bookingId,
  origin,
  resend = false,
}: SendBookingApprovalEmailOptions): Promise<BookingApprovalEmailOutcome> {
  try {
    const missingSettings = missingBookingEmailSettings();
    if (!isBookingEmailConfigured() || missingSettings.length > 0) {
      console.error("Booking emails are not configured. Set the missing server settings.", { missingSettings });
      return { sent: false, reason: "not_configured" };
    }

    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);
    if (!booking) return { sent: false, reason: "not_found" };
    if (resend && !APPROVED_BOOKING_STATUSES.has(booking.status)) {
      return { sent: false, reason: "not_approved" };
    }

    const [
      { data: paymentRows, error: paymentError },
      { data: agreementRow, error: agreementError },
    ] = await Promise.all([
      admin
        .from("booking_payment_submissions")
        .select("declared_amount, status")
        .eq("booking_id", bookingId),
      admin
        .from("booking_agreements")
        .select("id, status")
        .eq("booking_id", bookingId)
        .maybeSingle(),
    ]);
    if (paymentError || agreementError) {
      console.error("Approval email could not load final booking records", {
        bookingId,
        paymentError: paymentError?.message,
        agreementError: agreementError?.message,
      });
      return { sent: false, reason: "load_failed" };
    }

    const hasVerifiedPayment = (paymentRows ?? []).some((row) => row.status === "verified");
    if (
      booking.requirementsStatus !== "approved" ||
      !hasVerifiedPayment ||
      agreementRow?.status !== "completed"
    ) {
      return { sent: false, reason: "not_ready" };
    }

    const { data: agreementVersion, error: versionError } = await admin
      .from("agreement_versions")
      .select("id, final_document_path")
      .eq("agreement_id", agreementRow.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError) {
      console.error("Approval email could not load the signed agreement", {
        bookingId,
        error: versionError.message,
      });
      return { sent: false, reason: "load_failed" };
    }
    if (!agreementVersion?.final_document_path) return { sent: false, reason: "not_ready" };

    const { data: signatureRows, error: signatureError } = await admin
      .from("agreement_signatures")
      .select("signer_role")
      .eq("agreement_version_id", agreementVersion.id);
    if (signatureError) {
      console.error("Approval email could not verify the business signature", {
        bookingId,
        error: signatureError.message,
      });
      return { sent: false, reason: "load_failed" };
    }
    if (!(signatureRows ?? []).some((signature) => signature.signer_role === "business")) {
      return { sent: false, reason: "not_ready" };
    }

    const { data: contractBlob, error: contractError } = await admin.storage
      .from("agreements")
      .download(agreementVersion.final_document_path);
    if (contractError || !contractBlob) {
      console.error("Approval email could not download the final agreement PDF", {
        bookingId,
        path: agreementVersion.final_document_path,
        error: contractError?.message,
      });
      return { sent: false, reason: "load_failed" };
    }

    const contractFileName = `signed-rental-agreement-${booking.bookingRef.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`;
    const attachments = [{
      filename: contractFileName,
      content: Buffer.from(await contractBlob.arrayBuffer()).toString("base64"),
    }];

    let fallbackEmail: string | null = null;
    if (!booking.customerSnapshot.email.trim()) {
      const { data: authUser } = await admin.auth.admin.getUserById(booking.customerId);
      fallbackEmail = authUser?.user?.email ?? null;
    }

    const stamp = booking.approvedAt || booking.updatedAt;
    const details = buildApprovalEmailDetails({
      booking,
      payments: (paymentRows ?? []).map((row) => ({
        declaredAmount: row.declared_amount,
        status: row.status,
      })),
      fallbackEmail,
      origin,
      deliveryKey: resend
        ? `booking-approved-resend-${booking.id}-${Date.now()}`
        : `booking-approved-${booking.id}-${stamp}`,
    });

    const result = await sendBookingStatusEmail(details, attachments);
    return result.sent
      ? {
          sent: true,
          emailedTo: details.customerEmail,
          providerId: result.providerId,
          contractFileName,
        }
      : { sent: false, reason: result.reason };
  } catch (error) {
    console.error("Approval email failed unexpectedly", {
      bookingId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { sent: false, reason: "load_failed" };
  }
}
