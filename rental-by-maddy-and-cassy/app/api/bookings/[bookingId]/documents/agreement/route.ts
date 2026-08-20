import { NextResponse } from "next/server";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { generateAndSaveFinalAgreement } from "@/src/lib/server/customerDocuments";
import { getBookingById } from "@/src/services/bookingService";
import type { AgreementDoc } from "@/src/types/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * Renders the customer-signed draft PDF right after submission (stored in
 * the current agreement_versions row's generated_document_path) — distinct
 * from the final, business-countersigned PDF stored in final_document_path,
 * which paymentFulfillment.ts generates once the booking auto-confirms.
 */
export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "signed-agreement", 6, 60_000);
    const { user } = await requireUser();
    const { bookingId } = await params;
    const admin = createAdminClient();

    const booking = await getBookingById(admin, bookingId);
    const { data: agreementRow } = await admin
      .from("booking_agreements")
      .select("*")
      .eq("booking_id", bookingId)
      .maybeSingle();

    if (!booking || !agreementRow) return errorResponse("The signed agreement could not be found.", 404);
    if (booking.customerId !== user.id) return errorResponse("You do not have access to this booking.", 403);
    if (agreementRow.status !== "awaiting_business_signature") {
      return errorResponse("The rental agreement has not been submitted.", 409);
    }

    const { data: verifiedPayment } = await admin
      .from("booking_payment_submissions")
      .select("id, paymongo_payment_id, external_reference")
      .eq("booking_id", bookingId)
      .eq("status", "verified")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!verifiedPayment) return errorResponse("A verified reservation payment is required first.", 409);

    const { data: versions } = await admin
      .from("agreement_versions")
      .select("*")
      .eq("agreement_id", agreementRow.id)
      .order("version_number", { ascending: false });
    const currentVersion = versions?.[0];
    if (!currentVersion) return errorResponse("The signed agreement could not be found.", 404);

    const { data: signatures } = await admin
      .from("agreement_signatures")
      .select("*")
      .eq("agreement_version_id", currentVersion.id);

    const agreement: AgreementDoc = {
      id: agreementRow.id,
      bookingId: agreementRow.booking_id,
      status: agreementRow.status,
      currentVersionId: currentVersion.id,
      versionNumber: currentVersion.version_number,
      agreementSnapshot: currentVersion.agreement_snapshot as unknown as AgreementDoc["agreementSnapshot"],
      generatedDocumentPath: currentVersion.generated_document_path ?? undefined,
      finalDocumentPath: currentVersion.final_document_path ?? undefined,
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
    };

    const storagePath = `${user.id}/${bookingId}/signed-agreement-${booking.bookingRef}.pdf`;
    await generateAndSaveFinalAgreement(admin, {
      booking,
      agreement,
      paymentReference: verifiedPayment.paymongo_payment_id || verifiedPayment.external_reference || "Verified payment",
      storagePath,
    });

    await admin
      .from("agreement_versions")
      .update({ generated_document_path: storagePath, generated_at: new Date().toISOString() })
      .eq("id", currentVersion.id);

    return NextResponse.json({ success: true, storagePath });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    console.error("Signed agreement PDF generation failed", error);
    return errorResponse("The signed agreement PDF could not be prepared.", 500);
  }
}
