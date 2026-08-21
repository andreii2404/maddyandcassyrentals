import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  getClientIp,
  requireActiveAdmin,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { generateAndSaveFinalAgreement } from "@/src/lib/server/customerDocuments";
import { getBookingById } from "@/src/services/bookingService";
import type { AgreementDoc, AgreementSignature } from "@/src/types/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function mapSignature(row: {
  id: string;
  agreement_version_id: string;
  signer_user_id: string | null;
  signer_role: "customer" | "business";
  signer_name: string;
  signature_path: string | null;
  signature_data: unknown;
  signed_at: string;
}): AgreementSignature {
  return {
    id: row.id,
    agreementVersionId: row.agreement_version_id,
    signerUserId: row.signer_user_id ?? undefined,
    signerRole: row.signer_role,
    signerName: row.signer_name,
    signaturePath: row.signature_path ?? undefined,
    signatureData: (row.signature_data as Record<string, unknown>) ?? {},
    signedAt: row.signed_at,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    enforceRateLimit(request, "admin-agreement-countersign", 10, 60_000);
    const { user } = await requireActiveAdmin();
    const { bookingId } = await params;
    const body = (await request.json().catch(() => null)) as
      | { signerName?: unknown; acknowledged?: unknown }
      | null;
    const signerName = typeof body?.signerName === "string" ? body.signerName.trim() : "";

    if (signerName.length < 2 || signerName.length > 120) {
      return errorResponse("Enter the authorized business signer's complete name.", 400);
    }
    if (body?.acknowledged !== true) {
      return errorResponse("Confirm that you are authorized to countersign this agreement.", 400);
    }

    const admin = createAdminClient();
    const booking = await getBookingById(admin, bookingId);
    if (!booking) return errorResponse("The selected booking could not be found.", 404);
    if (booking.requirementsStatus !== "approved") {
      return errorResponse("Approve every required verification document before countersigning.", 409);
    }

    const [{ data: agreementRow }, { data: verifiedPayment }] = await Promise.all([
      admin.from("booking_agreements").select("*").eq("booking_id", bookingId).maybeSingle(),
      admin
        .from("booking_payment_submissions")
        .select("id, paymongo_payment_id, external_reference")
        .eq("booking_id", bookingId)
        .eq("status", "verified")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!agreementRow) return errorResponse("The customer agreement has not been submitted.", 409);
    if (agreementRow.status === "completed") {
      return NextResponse.json({ success: true, alreadyCompleted: true });
    }
    if (agreementRow.status !== "awaiting_business_signature") {
      return errorResponse("This agreement is not ready for a business countersignature.", 409);
    }
    if (!verifiedPayment) {
      return errorResponse("A verified reservation payment is required before countersigning.", 409);
    }

    const { data: currentVersion } = await admin
      .from("agreement_versions")
      .select("*")
      .eq("agreement_id", agreementRow.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!currentVersion) return errorResponse("The current agreement version could not be found.", 404);

    const { data: signatureRows } = await admin
      .from("agreement_signatures")
      .select("*")
      .eq("agreement_version_id", currentVersion.id);
    const customerSignature = signatureRows?.find((signature) => signature.signer_role === "customer");
    if (!customerSignature) {
      return errorResponse("The customer's electronic signature is still required.", 409);
    }

    const now = new Date().toISOString();
    let businessSignature = signatureRows?.find((signature) => signature.signer_role === "business");
    if (!businessSignature) {
      const { data, error } = await admin
        .from("agreement_signatures")
        .insert({
          agreement_version_id: currentVersion.id,
          signer_user_id: user.id,
          signer_role: "business",
          signer_name: signerName,
          signature_data: {
            method: "typed_admin_countersignature",
            authorized: true,
          },
          signed_at: now,
          ip_address: getClientIp(request),
          user_agent: request.headers.get("user-agent"),
        })
        .select("*")
        .single();
      if (error || !data) throw new Error(error?.message ?? "BUSINESS_SIGNATURE_NOT_SAVED");
      businessSignature = data;
    }

    const signatures = [...(signatureRows ?? []).filter((signature) => signature.signer_role !== "business"), businessSignature]
      .map(mapSignature);
    const agreement: AgreementDoc = {
      id: agreementRow.id,
      bookingId,
      status: "completed",
      currentVersionId: currentVersion.id,
      versionNumber: currentVersion.version_number,
      agreementSnapshot: currentVersion.agreement_snapshot as unknown as AgreementDoc["agreementSnapshot"],
      generatedDocumentPath: currentVersion.generated_document_path ?? undefined,
      finalDocumentPath: currentVersion.final_document_path ?? undefined,
      generatedAt: currentVersion.generated_at ?? undefined,
      completedAt: now,
      createdBy: agreementRow.created_by ?? undefined,
      createdAt: agreementRow.created_at,
      updatedAt: now,
      signatures,
    };
    const finalPath = `${booking.customerId}/${booking.id}/final-agreement-${booking.bookingRef}.pdf`;

    await generateAndSaveFinalAgreement(admin, {
      booking,
      agreement,
      paymentReference:
        verifiedPayment.external_reference ||
        verifiedPayment.paymongo_payment_id ||
        "Verified GCash payment",
      storagePath: finalPath,
    });

    const [{ error: versionError }, { error: agreementError }] = await Promise.all([
      admin
        .from("agreement_versions")
        .update({ status: "completed", completed_at: now, final_document_path: finalPath })
        .eq("id", currentVersion.id),
      admin
        .from("booking_agreements")
        .update({ status: "completed", completed_at: now })
        .eq("id", agreementRow.id),
    ]);
    if (versionError || agreementError) {
      throw new Error(versionError?.message ?? agreementError?.message ?? "AGREEMENT_NOT_FINALIZED");
    }

    await Promise.all([
      admin.from("notifications").insert({
        user_id: booking.customerId,
        booking_id: booking.id,
        notification_type: "agreement_completed",
        title: "Rental agreement completed",
        message: `Your agreement for ${booking.bookingRef} was countersigned by the business. The final PDF is ready.`,
        action_url: `/account/bookings/${booking.id}#booking-documents`,
      }),
      admin.rpc("log_audit_event", {
        p_action: "agreement.business_countersigned",
        p_entity_type: "booking_agreement",
        p_entity_id: agreementRow.id,
        p_booking_id: booking.id,
        p_previous_values: { status: agreementRow.status },
        p_new_values: { status: "completed", signerName: businessSignature.signer_name },
      }),
    ]);

    return NextResponse.json({ success: true, agreementStatus: "completed" });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Business agreement countersign failed", error);
    return errorResponse("The agreement could not be countersigned. Please try again.", 500);
  }
}
