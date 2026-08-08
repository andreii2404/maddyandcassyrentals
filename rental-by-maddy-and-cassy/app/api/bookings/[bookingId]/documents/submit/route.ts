import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const metadataSchema = z.object({
  submissionId: z.string().uuid(),
  files: z.object({
    idOne: z.string().min(1),
    idTwo: z.string().min(1),
    selfie: z.string().min(1),
    emergencyId: z.string().min(1),
    signature: z.string().min(1),
  }),
  facebookLink: z.string().url().max(1000),
  instagramLink: z.string().url().max(1000),
  emergencyContact: z.object({
    fullName: z.string().trim().min(2).max(160),
    relationship: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(7).max(40),
    facebookLink: z.string().url().max(1000),
  }),
  acknowledgements: z.object({
    infoAccurate: z.literal(true),
    agreedToTerms: z.literal(true),
    understoodRentalRules: z.literal(true),
    authorizedESignature: z.literal(true),
    readPrivacyNotice: z.literal(true),
    emergencyContactAuthorized: z.literal(true),
  }),
  signatureMethod: z.enum(["drawn", "uploaded"]),
  typedFullName: z.string().trim().min(2).max(160),
});

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function expectedPrefix(userId: string, bookingId: string, fileName: string, submissionId: string): string {
  return `${userId}/${bookingId}/${fileName}-${submissionId}.`;
}

async function verifyUploadedFile(
  admin: ReturnType<typeof createAdminClient>,
  bucket: "booking-documents" | "customer-documents",
  path: string,
  expectedPathPrefix: string,
): Promise<void> {
  if (!path.startsWith(expectedPathPrefix) || path.slice(expectedPathPrefix.length).includes("/")) {
    throw new RequestSecurityError("An uploaded document reference is invalid.", 400);
  }
  const folder = path.slice(0, path.lastIndexOf("/"));
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const { data } = await admin.storage.from(bucket).list(folder, { search: fileName });
  if (!data?.some((entry) => entry.name === fileName)) {
    throw new RequestSecurityError("An uploaded document could not be verified.", 400);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "booking-document-submit", 8, 10 * 60_000);
    const { user } = await requireUser();
    const { bookingId } = await params;
    const input = metadataSchema.parse(await request.json());
    const admin = createAdminClient();

    await Promise.all([
      verifyUploadedFile(admin, "booking-documents", input.files.idOne, expectedPrefix(user.id, bookingId, "id-one", input.submissionId)),
      verifyUploadedFile(admin, "booking-documents", input.files.idTwo, expectedPrefix(user.id, bookingId, "id-two", input.submissionId)),
      verifyUploadedFile(admin, "booking-documents", input.files.selfie, expectedPrefix(user.id, bookingId, "selfie", input.submissionId)),
      verifyUploadedFile(admin, "booking-documents", input.files.emergencyId, expectedPrefix(user.id, bookingId, "emergency-contact-id", input.submissionId)),
      verifyUploadedFile(admin, "customer-documents", input.files.signature, expectedPrefix(user.id, bookingId, "signature", input.submissionId)),
    ]);

    const booking = await getBookingById(admin, bookingId);
    if (!booking) return errorResponse("The booking could not be found.", 404);
    if (booking.customerId !== user.id) return errorResponse("You do not have access to this booking.", 403);
    if (booking.requirementsStatus !== "not_submitted") {
      return errorResponse("Verification documents have already been submitted.", 409);
    }
    const { data: verifiedPayment } = await admin
      .from("booking_payment_submissions")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("status", "verified")
      .limit(1)
      .maybeSingle();
    if (!verifiedPayment) {
      return errorResponse("Complete the reservation payment before submitting documents.", 409);
    }

    const now = new Date().toISOString();

    // There is no more booking_documents table: each uploaded file becomes a
    // customer_documents row, wired to this booking through a booking_requirements
    // row (ad hoc — there's no seeded product_requirements/requirement_definitions
    // data for these four fixed document types yet) and a
    // booking_requirement_submissions row that ties the two together.
    const documentRows = [
      { type: "government_id" as const, path: input.files.idOne, name: "id-one", label: "Primary Government ID" },
      { type: "secondary_id" as const, path: input.files.idTwo, name: "id-two", label: "Secondary ID" },
      { type: "selfie_with_id" as const, path: input.files.selfie, name: "selfie", label: "Selfie with ID" },
      {
        type: "authorization_letter" as const,
        path: input.files.emergencyId,
        name: "emergency-contact-id",
        label: "Emergency Contact ID",
      },
    ];

    for (const doc of documentRows) {
      const { data: customerDocument, error: customerDocumentError } = await admin
        .from("customer_documents")
        .insert({
          owner_user_id: user.id,
          document_type: doc.type,
          storage_bucket: "booking-documents",
          storage_path: doc.path,
          original_filename: doc.name,
          status: "active",
        })
        .select("id")
        .single();
      if (customerDocumentError || !customerDocument) {
        throw new Error(customerDocumentError?.message ?? "A verification document could not be recorded.");
      }

      const { data: requirement, error: requirementError } = await admin
        .from("booking_requirements")
        .insert({
          booking_id: bookingId,
          document_type_snapshot: doc.type,
          requirement_key_snapshot: doc.type,
          requirement_name_snapshot: doc.label,
          is_required: true,
          status: "pending_review",
        })
        .select("id")
        .single();
      if (requirementError || !requirement) {
        throw new Error(requirementError?.message ?? "A booking requirement could not be recorded.");
      }

      const { error: submissionError } = await admin.from("booking_requirement_submissions").insert({
        booking_requirement_id: requirement.id,
        customer_document_id: customerDocument.id,
        review_status: "pending",
        submitted_at: now,
      });
      if (submissionError) throw new Error(submissionError.message);
    }

    const agreementSnapshot = {
      customerName: booking.customerSnapshot.fullName || input.typedFullName,
      productName: booking.productSnapshot.name || "Rental item",
      quantity: booking.quantity,
      startDate: booking.startDate,
      endDate: booking.endDate,
      dayCount: booking.dayCount || 1,
      fulfillmentMethod: booking.fulfillmentMethod,
      customerLocation: booking.location || "",
      pricePerDay: booking.dailyRate,
      currency: "PHP",
      includedAccessories: booking.productSnapshot.included ?? [],
    };

    const { data: agreement, error: agreementError } = await admin
      .from("booking_agreements")
      .insert({
        booking_id: bookingId,
        status: "awaiting_business_signature",
        created_by: user.id,
      })
      .select("id")
      .single();
    if (agreementError || !agreement) throw new Error(agreementError?.message ?? "Agreement could not be created.");

    const { data: agreementVersion, error: versionError } = await admin
      .from("agreement_versions")
      .insert({
        agreement_id: agreement.id,
        version_number: 1,
        status: "awaiting_business_signature",
        agreement_snapshot: agreementSnapshot,
        generated_at: now,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (versionError || !agreementVersion) {
      throw new Error(versionError?.message ?? "Agreement version could not be created.");
    }

    await admin.from("agreement_acknowledgements").insert(
      (Object.keys(input.acknowledgements) as Array<keyof typeof input.acknowledgements>).map((key) => ({
        agreement_version_id: agreementVersion.id,
        user_id: user.id,
        acknowledgement_key: key,
        acknowledged: true,
        acknowledged_at: now,
      })),
    );

    await admin.from("agreement_signatures").insert({
      agreement_version_id: agreementVersion.id,
      signer_user_id: user.id,
      signer_role: "customer",
      signer_name: input.typedFullName,
      signature_path: input.files.signature,
      signature_data: { method: input.signatureMethod },
      signed_at: now,
    });

    await admin.from("booking_emergency_contacts").upsert(
      {
        booking_id: bookingId,
        full_name: input.emergencyContact.fullName,
        relationship: input.emergencyContact.relationship,
        phone_number: input.emergencyContact.phone,
        address: "",
      },
      { onConflict: "booking_id" },
    );

    // requirements_status / agreement_status are derived, not stored columns
    // on bookings anymore — nothing to update there.
    await admin.from("booking_status_history").insert({
      booking_id: bookingId,
      from_status: booking.status,
      to_status: booking.status,
      note: "Customer submitted verification documents and signed the rental agreement.",
      changed_by: user.id,
    });

    await admin.rpc("log_audit_event", {
      p_action: "booking.documents_submitted",
      p_entity_type: "booking",
      p_entity_id: bookingId,
      p_booking_id: bookingId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return errorResponse("Check the verification details and agreement, then try again.", 400);
    }
    console.error("Booking document finalization failed", error);
    return errorResponse("The documents could not be finalized. Please try again.", 500);
  }
}
