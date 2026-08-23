import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/src/lib/supabase/database.types";
import { toJson } from "@/src/lib/supabase/types";
import { getBookingById } from "@/src/services/bookingService";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import {
  generateAndSaveFinalAgreement,
  generateAndSaveReceipt,
} from "@/src/lib/server/customerDocuments";

function documentNumber(prefix: string, bookingRef: string, id: string): string {
  const cleanBooking = bookingRef.replace(/[^A-Z0-9-]/gi, "").toUpperCase();
  return `${prefix}-${cleanBooking}-${id.slice(0, 6).toUpperCase()}`;
}

export interface FulfillPaymentInput {
  paymentSubmissionId: string;
  providerPaymentId: string;
  paymentMethod: string;
  providerStatus?: string;
  providerMetadata?: Record<string, unknown>;
  providerEventId?: string;
}

export interface FulfillPaymentResult {
  alreadyProcessed: boolean;
  bookingId: string;
  bookingConfirmed: boolean;
}

/**
 * Runs every side effect of a verified payment: marks the payment submission
 * verified, issues a receipt (with PDF), logs the event, and — if every other
 * confirmation gate already cleared — flips the booking to 'confirmed' via the
 * service-role-only system_confirm_booking() RPC and finalizes the signed
 * agreement PDF. Called from the admin manual-payment-review route after an
 * administrator has verified a customer's submitted GCash proof of payment,
 * always with the service-role (RLS-bypassing) admin client — never from
 * client-supplied status alone. (Formerly also called from the PayMongo
 * webhook and sandbox demo-complete route before payments moved to manual
 * GCash review; `providerPaymentId` still lands in the paymongo_payment_id
 * column, which now doubles as a general external-reference slot.)
 *
 * There is no more booking_invoices table, so the old "update the matching
 * invoice's amount_paid/balance_due" step has no equivalent and is dropped —
 * booking_totals + booking_payment_submissions already give a live balance.
 */
export async function fulfillVerifiedPayment(
  admin: SupabaseClient<Database>,
  input: FulfillPaymentInput,
): Promise<FulfillPaymentResult> {
  const { data: payment, error: paymentError } = await admin
    .from("booking_payment_submissions")
    .select("*")
    .eq("id", input.paymentSubmissionId)
    .single();

  if (paymentError || !payment) {
    throw new Error("PAYMENT_SUBMISSION_NOT_FOUND");
  }

  if (payment.status === "verified") {
    return { alreadyProcessed: true, bookingId: payment.booking_id, bookingConfirmed: false };
  }

  const booking = await getBookingById(admin, payment.booking_id);
  if (!booking) throw new Error("BOOKING_NOT_FOUND");

  const now = new Date().toISOString();
  const mergedMetadata = {
    ...((payment.provider_metadata as Record<string, unknown>) ?? {}),
    ...(input.providerMetadata ?? {}),
  };
  await admin
    .from("booking_payment_submissions")
    .update({
      status: "verified",
      paymongo_payment_id: input.providerPaymentId,
      payment_method: input.paymentMethod,
      provider_metadata: toJson(mergedMetadata),
      reviewed_at: now,
      completed_at: now,
    })
    .eq("id", payment.id);

  const receiptId = crypto.randomUUID();
  const receiptNumber = documentNumber("OR", booking.bookingRef, receiptId);
  const receiptPath = `${booking.customerId}/${booking.id}/${receiptNumber}.pdf`;

  await generateAndSaveReceipt(admin, {
    booking,
    receiptNumber,
    paymentReference: input.providerPaymentId,
    paymentMethod: input.paymentMethod,
    storagePath: receiptPath,
    amount: payment.declared_amount,
  });

  await admin.from("booking_receipts").insert({
    id: receiptId,
    booking_id: booking.id,
    payment_submission_id: payment.id,
    receipt_number: receiptNumber,
    amount: payment.declared_amount,
    document_path: receiptPath,
    issued_at: now,
  });

  await admin.rpc("log_audit_event", {
    p_action: "payment.verified",
    p_entity_type: "payment_submission",
    p_entity_id: payment.id,
    p_booking_id: booking.id,
    p_previous_values: { status: payment.status },
    p_new_values: {
      status: "verified",
      providerPaymentId: input.providerPaymentId,
      paymentMethod: input.paymentMethod,
    },
  });

  await admin.from("notifications").insert({
    user_id: booking.customerId,
    booking_id: booking.id,
    notification_type: "payment_verified",
    title: "Payment confirmed",
    message: `Your payment for ${booking.bookingRef} was verified. Your receipt is ready.`,
    action_url: bookingTrackingPath(booking.id, booking.isGuestCheckout),
  });

  let bookingConfirmed = false;
  const { data: agreementRow } = await admin
    .from("booking_agreements")
    .select("*")
    .eq("booking_id", booking.id)
    .maybeSingle();

  if (agreementRow?.status === "completed" && booking.status === "approved") {
    const { data: confirmedBooking, error: confirmError } = await admin.rpc(
      "system_confirm_booking",
      { p_booking_id: booking.id, p_note: "Auto-confirmed after verified GCash payment." },
    );

    if (!confirmError && confirmedBooking) {
      const confirmed = confirmedBooking as Tables<"bookings">;
      if (confirmed.status === "confirmed") {
        bookingConfirmed = true;

        const { data: versions } = await admin
          .from("agreement_versions")
          .select("*")
          .eq("agreement_id", agreementRow.id)
          .order("version_number", { ascending: false });
        const currentVersion = versions?.[0];

        const { data: signatures } = currentVersion
          ? await admin.from("agreement_signatures").select("*").eq("agreement_version_id", currentVersion.id)
          : { data: [] as Tables<"agreement_signatures">[] };

        const confirmedBookingDetails = await getBookingById(admin, confirmed.id);
        if (!confirmedBookingDetails) throw new Error("BOOKING_NOT_FOUND_AFTER_CONFIRM");

        const agreementPath = `${booking.customerId}/${booking.id}/final-agreement-${booking.bookingRef}.pdf`;
        await generateAndSaveFinalAgreement(admin, {
          booking: confirmedBookingDetails,
          agreement: {
            id: agreementRow.id,
            bookingId: agreementRow.booking_id,
            status: agreementRow.status,
            currentVersionId: currentVersion?.id,
            versionNumber: currentVersion?.version_number,
            agreementSnapshot: currentVersion?.agreement_snapshot as never,
            generatedDocumentPath: currentVersion?.generated_document_path ?? undefined,
            finalDocumentPath: currentVersion?.final_document_path ?? undefined,
            generatedAt: currentVersion?.generated_at ?? undefined,
            completedAt: currentVersion?.completed_at ?? undefined,
            createdAt: agreementRow.created_at,
            updatedAt: agreementRow.updated_at,
            signatures: (signatures ?? []).map((s) => ({
              id: s.id,
              agreementVersionId: s.agreement_version_id,
              signerUserId: s.signer_user_id ?? undefined,
              signerRole: s.signer_role,
              signerName: s.signer_name,
              signaturePath: s.signature_path ?? undefined,
              signatureData: (s.signature_data as Record<string, unknown>) ?? {},
              signedAt: s.signed_at,
            })),
          },
          paymentReference: input.providerPaymentId,
          storagePath: agreementPath,
        });

        if (currentVersion) {
          await admin
            .from("agreement_versions")
            .update({ final_document_path: agreementPath })
            .eq("id", currentVersion.id);
        }
      }
    }
  }

  return { alreadyProcessed: false, bookingId: booking.id, bookingConfirmed };
}
