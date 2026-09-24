import "server-only";

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";

const APPROVED_BOOKING_STATUSES = new Set([
  "approved",
  "confirmed",
  "ready_for_release",
  "released",
]);

export interface BookingApprovalEmailOutcome {
  sent: boolean;
  emailedTo?: string;
  providerId?: string;
  contractFileName?: string;
  reason?:
    | "not_found"
    | "not_approved"
    | "not_ready"
    | "load_failed"
    | "invalid_recipient";
}

interface SendBookingApprovalEmailOptions {
  bookingId: string;
  origin: string;
  resend?: boolean;
}

export async function sendBookingApprovalEmail({
  bookingId,
  origin: _origin,
  resend = false,
}: SendBookingApprovalEmailOptions): Promise<BookingApprovalEmailOutcome> {
  try {
    const admin = createAdminClient();

    // ---------------------------------------------------------
    // 1. Load booking
    // ---------------------------------------------------------
    const booking = await getBookingById(admin, bookingId);

    if (!booking) {
      return {
        sent: false,
        reason: "not_found",
      };
    }

    // ---------------------------------------------------------
    // 2. Booking must already be approved
    // ---------------------------------------------------------
    if (
      resend &&
      !APPROVED_BOOKING_STATUSES.has(booking.status)
    ) {
      return {
        sent: false,
        reason: "not_approved",
      };
    }

    // ---------------------------------------------------------
    // 3. Load payment + agreement
    // ---------------------------------------------------------
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
      console.error(
        "Confirmation email could not load booking records",
        {
          bookingId,
          paymentError: paymentError?.message,
          agreementError: agreementError?.message,
        },
      );

      return {
        sent: false,
        reason: "load_failed",
      };
    }

    const hasVerifiedPayment = (paymentRows ?? []).some(
      (row) => row.status === "verified",
    );

    if (
      booking.requirementsStatus !== "approved" ||
      !hasVerifiedPayment ||
      agreementRow?.status !== "completed"
    ) {
      return {
        sent: false,
        reason: "not_ready",
      };
    }

    // ---------------------------------------------------------
    // 4. Get latest signed agreement version
    // ---------------------------------------------------------
    const { data: agreementVersion, error: versionError } =
      await admin
        .from("agreement_versions")
        .select("id, final_document_path")
        .eq("agreement_id", agreementRow.id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (versionError) {
      console.error(
        "Confirmation email could not load signed agreement",
        {
          bookingId,
          error: versionError.message,
        },
      );

      return {
        sent: false,
        reason: "load_failed",
      };
    }

    if (!agreementVersion?.final_document_path) {
      return {
        sent: false,
        reason: "not_ready",
      };
    }

    // ---------------------------------------------------------
    // 5. Verify business signature
    // ---------------------------------------------------------
    const { data: signatureRows, error: signatureError } =
      await admin
        .from("agreement_signatures")
        .select("signer_role")
        .eq("agreement_version_id", agreementVersion.id);

    if (signatureError) {
      console.error(
        "Confirmation email could not verify business signature",
        {
          bookingId,
          error: signatureError.message,
        },
      );

      return {
        sent: false,
        reason: "load_failed",
      };
    }

    const hasBusinessSignature = (signatureRows ?? []).some(
      (signature) => signature.signer_role === "business",
    );

    if (!hasBusinessSignature) {
      return {
        sent: false,
        reason: "not_ready",
      };
    }

    // ---------------------------------------------------------
    // 6. Verify customer email
    // ---------------------------------------------------------
    let customerEmail =
      booking.customerSnapshot.email?.trim() || "";

    if (!customerEmail) {
      const { data: authUser } =
        await admin.auth.admin.getUserById(
          booking.customerId,
        );

      customerEmail =
        authUser?.user?.email?.trim() || "";
    }

    if (!customerEmail) {
      return {
        sent: false,
        reason: "invalid_recipient",
      };
    }

    // ---------------------------------------------------------
    // 7. Create contract filename
    // ---------------------------------------------------------
    const contractFileName =
      `signed-rental-agreement-${booking.bookingRef
        .replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`;

    // ---------------------------------------------------------
    // 8. Add email to the existing email queue
    // ---------------------------------------------------------
const { data: queuedEmail, error: queueError } =
  await admin
    .from("email_notifications")
    .insert({
      booking_id: bookingId,
      recipient_email: customerEmail,
      recipient_name: "Customer",
      email_type: "booking_confirmation_contract",
      subject:
        `Booking Confirmation & Signed Contract - ${booking.bookingRef} | Maddy & Cassy Rentals`,
      status: "pending",
    })
    .select("id")
    .single();

    if (queueError || !queuedEmail) {
      console.error(
        "Failed to queue booking confirmation email",
        {
          bookingId,
          error: queueError?.message,
        },
      );

      return {
        sent: false,
        reason: "load_failed",
      };
    }

    console.log(
      "Booking confirmation email queued",
      {
        bookingId,
        emailId: queuedEmail.id,
        recipient: customerEmail,
        contractFileName,
        resend,
      },
    );

    return {
      sent: true,
      emailedTo: customerEmail,
      providerId: queuedEmail.id,
      contractFileName,
    };
  } catch (error) {
    console.error(
      "Booking confirmation email failed unexpectedly",
      {
        bookingId,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
    );

    return {
      sent: false,
      reason: "load_failed",
    };
  }
}