import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";
import {
  activeUnitAssignments,
  assertUnitAssignmentsComplete,
  getBookingUnitAssignments,
  IncompleteUnitAssignmentError,
} from "@/src/services/unitAssignmentService";
import { toJson } from "@/src/lib/supabase/types";
import type { AgreementSnapshot } from "@/src/types/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const metadataSchema = z.object({
  submissionId: z.string().uuid(),
  files: z.object({
    // idOne/idTwo/selfie are optional: returning customers may reuse a
    // previously verified document instead of re-uploading (see reusedDocuments).
    idOne: z.string().min(1).optional(),
    idTwo: z.string().min(1).optional(),
    selfie: z.string().min(1).optional(),
    emergencyId: z.string().min(1),
    signature: z.string().min(1),
  }),
  reusedDocuments: z
    .object({
      idOne: z.string().uuid().optional(),
      idTwo: z.string().uuid().optional(),
      selfie: z.string().uuid().optional(),
    })
    .default({}),
  facebookLink: z.string().url().max(1000),
  instagramLink: z.string().url().max(1000),
  emergencyContact: z.object({
    fullName: z.string().trim().min(2).max(160),
    relationship: z.string().trim().min(2).max(100),
    phone: z.string().trim().regex(/^\d{11}$/, "Phone number must contain exactly 11 digits."),
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

const REUSED_SLOT_TYPES = {
  idOne: "government_id",
  idTwo: "secondary_id",
  selfie: "selfie_with_id",
} as const;

type ReusedSlot = keyof typeof REUSED_SLOT_TYPES;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

interface SupabaseFailure {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

function throwSupabaseFailure(operation: string, error: SupabaseFailure): never {
  const diagnostic = [
    error.message,
    error.code ? `code=${error.code}` : "",
    error.details ? `details=${error.details}` : "",
    error.hint ? `hint=${error.hint}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  throw new Error(`${operation} failed: ${diagnostic}`, { cause: error });
}

function expectedPrefix(userId: string, bookingId: string, fileName: string, submissionId: string): string {
  return `${userId}/${bookingId}/${fileName}-${submissionId}.`;
}

function slotToFileName(slot: "idOne" | "idTwo" | "selfie"): string {
  if (slot === "idOne") return "id-one";
  if (slot === "idTwo") return "id-two";
  return "selfie";
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
  const { data, error } = await admin.storage.from(bucket).list(folder, { search: fileName });
  if (error) throwSupabaseFailure(`Storage verification for ${bucket}`, error);
  if (!data?.some((entry) => entry.name === fileName)) {
    throw new RequestSecurityError("An uploaded document could not be verified.", 400);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    enforceRateLimit(request, "booking-document-submit", 8, 10 * 60_000);
    const { supabase, user } = await requireUser();
    const { bookingId } = await params;
    const input = metadataSchema.parse(await request.json());
    const admin = createAdminClient();

    // Each reusable slot (first ID, second ID, selfie) must be satisfied by
    // exactly one source: a fresh upload or a reused verified document.
    for (const slot of Object.keys(REUSED_SLOT_TYPES) as ReusedSlot[]) {
      if (Boolean(input.files[slot]) === Boolean(input.reusedDocuments[slot])) {
        return errorResponse(
          "Each verification document must be either freshly uploaded or reused from your verified records.",
          400,
        );
      }
    }

    const freshUploads = (Object.keys(REUSED_SLOT_TYPES) as ReusedSlot[])
      .filter((slot) => input.files[slot])
      .map((slot) => ({
        bucket: "booking-documents" as const,
        path: input.files[slot]!,
        prefix: expectedPrefix(user.id, bookingId, slotToFileName(slot), input.submissionId),
      }));
    freshUploads.push({
      bucket: "booking-documents" as const,
      path: input.files.emergencyId,
      prefix: expectedPrefix(user.id, bookingId, "emergency-contact-id", input.submissionId),
    });

    await Promise.all([
      ...freshUploads.map((upload) =>
        verifyUploadedFile(admin, upload.bucket, upload.path, upload.prefix),
      ),
      verifyUploadedFile(
        admin,
        "customer-documents",
        input.files.signature,
        expectedPrefix(user.id, bookingId, "signature", input.submissionId),
      ),
    ]);

    // Validate every reused document: it must belong to this customer, still
    // be active, match the expected document type, be unexpired, and have at
    // least one admin-approved verification on a previous booking.
    const reusedSlots = (Object.keys(REUSED_SLOT_TYPES) as ReusedSlot[]).filter(
      (slot) => input.reusedDocuments[slot],
    );
    const reusedDocumentIds = [
      ...new Set(reusedSlots.map((slot) => input.reusedDocuments[slot]!)),
    ];
    if (reusedDocumentIds.length) {
      const nowIso = new Date().toISOString();
      const [{ data: reusedDocs, error: reusedDocsError }, { data: approvedSubmissions, error: approvedError }] =
        await Promise.all([
          admin
            .from("customer_documents")
            .select("id, document_type, status, expires_at")
            .in("id", reusedDocumentIds)
            .eq("owner_user_id", user.id)
            .eq("status", "active"),
          admin
            .from("booking_requirement_submissions")
            .select("customer_document_id")
            .eq("review_status", "approved")
            .in("customer_document_id", reusedDocumentIds),
        ]);
      if (reusedDocsError) throwSupabaseFailure("Loading reused verification documents", reusedDocsError);
      if (approvedError) throwSupabaseFailure("Loading reused verification approvals", approvedError);

      const approvedIds = new Set(
        (approvedSubmissions ?? []).map((submission) => submission.customer_document_id),
      );
      const docById = new Map((reusedDocs ?? []).map((doc) => [doc.id, doc]));

      for (const slot of reusedSlots) {
        const documentId = input.reusedDocuments[slot]!;
        const doc = docById.get(documentId);
        const failure =
          !doc
            ? "A reused verification document could not be found on your account."
            : doc.document_type !== REUSED_SLOT_TYPES[slot]
              ? "A reused verification document no longer matches its slot."
              : doc.expires_at && doc.expires_at <= nowIso
                ? "A reused verification document has expired. Please upload a new copy."
                : !approvedIds.has(documentId)
                  ? "A reused verification document was never approved. Please upload a new copy."
                  : null;
        if (failure) return errorResponse(failure, 400);
      }
    }

    const booking = await getBookingById(admin, bookingId);
    if (!booking) return errorResponse("The booking could not be found.", 404);
    if (booking.customerId !== user.id) return errorResponse("You do not have access to this booking.", 403);
    if (booking.requirementsStatus !== "not_submitted") {
      return errorResponse("Verification documents have already been submitted.", 409);
    }
    // Manual GCash payments never reach "verified" until an admin reviews
    // them. Gate on the customer having submitted payment proof at all, not
    // on admin verification -- that happens later and must not block the
    // rest of the booking flow.
    const { data: submittedPayment, error: submittedPaymentError } = await admin
      .from("booking_payment_submissions")
      .select("id")
      .eq("booking_id", bookingId)
      .in("status", ["submitted", "under_review", "verified"])
      .limit(1)
      .maybeSingle();
    if (submittedPaymentError) {
      throwSupabaseFailure("Reservation payment verification", submittedPaymentError);
    }
    if (!submittedPayment) {
      return errorResponse("Submit your reservation payment proof before submitting documents.", 409);
    }

    // The agreement is about to be finalized for signing -- reconfirm every
    // item's active unit allocation from the real reservation rows (never a
    // placeholder) before freezing anything into the snapshot below.
    // get_booking_unit_assignments intentionally authorizes with auth.uid().
    // Calling it with the service-role client supplies no end-user identity
    // and returns 42501 NOT_AUTHORIZED. Use the already-verified customer
    // session; the RPC itself then confirms that this user owns the booking.
    const unitAssignments = await getBookingUnitAssignments(supabase, bookingId);
    try {
      assertUnitAssignmentsComplete(
        booking.items.map((item) => ({ bookingItemId: item.bookingItemId, quantity: item.quantity })),
        unitAssignments,
      );
    } catch (error) {
      if (error instanceof IncompleteUnitAssignmentError) {
        return errorResponse(
          "Your reserved units could not be fully confirmed. Please contact support before signing.",
          409,
        );
      }
      throw error;
    }

    const now = new Date().toISOString();

    // There is no more booking_documents table: each uploaded file becomes a
    // customer_documents row, wired to this booking through a booking_requirements
    // row (ad hoc — there's no seeded product_requirements/requirement_definitions
    // data for these four fixed document types yet) and a
    // booking_requirement_submissions row that ties the two together.
    //
    // Reused documents skip the storage upload and the new customer_documents
    // row entirely: the new booking's requirement submission points at the
    // SAME customer_documents row that was already verified on a previous
    // booking, so the file stays stored once and is simply linked again.
    const documentSlots = [
      { slot: "idOne" as const, type: "government_id" as const, label: "Primary Government ID" },
      { slot: "idTwo" as const, type: "secondary_id" as const, label: "Secondary ID" },
      { slot: "selfie" as const, type: "selfie_with_id" as const, label: "Selfie with ID" },
      { slot: "emergencyId" as const, type: "authorization_letter" as const, label: "Emergency Contact ID" },
    ];

    const freshSlots = documentSlots.filter((def) => {
      if (def.slot === "emergencyId") return true;
      return Boolean(input.files[def.slot]);
    });
    const freshPaths = new Map<string, string>(
      freshSlots.map((def) => [
        def.slot,
        def.slot === "emergencyId"
          ? input.files.emergencyId
          : input.files[def.slot]!,
      ]),
    );

    // The fresh documents are independent of one another, so recording them as
    // two bulk inserts (instead of a per-document loop doing three sequential
    // round trips each) cuts sequential DB calls down. Postgres preserves
    // input order in RETURNING for a single multi-row INSERT, so
    // freshSlots[i] <-> customerDocuments[i] line up.
    const { data: freshDocuments, error: customerDocumentsError } = await admin
      .from("customer_documents")
      .insert(
        freshSlots.map((def) => ({
          owner_user_id: user.id,
          document_type: def.type,
          storage_bucket: "booking-documents" as const,
          storage_path: freshPaths.get(def.slot)!,
          original_filename: def.slot === "emergencyId" ? "emergency-contact-id" : slotToFileName(def.slot as "idOne" | "idTwo" | "selfie"),
          status: "active" as const,
        })),
      )
      .select("id");
    if (customerDocumentsError || !freshDocuments || freshDocuments.length !== freshSlots.length) {
      if (customerDocumentsError) {
        throwSupabaseFailure("Recording verification documents", customerDocumentsError);
      }
      throw new Error("Recording verification documents returned an incomplete result.");
    }

    // Resolve the single customer_documents id per slot (fresh insert or reused row).
    const documentIdBySlot = new Map<string, string>();
    freshSlots.forEach((def, index) => {
      documentIdBySlot.set(def.slot, freshDocuments[index].id);
    });
    for (const slot of reusedSlots) {
      documentIdBySlot.set(slot, input.reusedDocuments[slot]!);
    }

    const { data: requirements, error: requirementsError } = await admin
      .from("booking_requirements")
      .insert(
        documentSlots.map((def) => ({
          booking_id: bookingId,
          document_type_snapshot: def.type,
          requirement_key_snapshot: def.type,
          requirement_name_snapshot: def.label,
          is_required: true,
          status: "pending_review" as const,
        })),
      )
      .select("id");
    if (requirementsError || !requirements || requirements.length !== documentSlots.length) {
      if (requirementsError) {
        throwSupabaseFailure("Recording booking requirements", requirementsError);
      }
      throw new Error("Recording booking requirements returned an incomplete result.");
    }

    const { error: submissionsError } = await admin.from("booking_requirement_submissions").insert(
      documentSlots.map((_def, index) => ({
        booking_requirement_id: requirements[index].id,
        customer_document_id: documentIdBySlot.get(documentSlots[index].slot)!,
        review_status: "pending" as const,
        submitted_at: now,
      })),
    );
    if (submissionsError) {
      throwSupabaseFailure("Linking verification documents to requirements", submissionsError);
    }

    const agreementSnapshot: AgreementSnapshot = {
      customerName: booking.customerSnapshot.fullName || input.typedFullName,
      items: booking.items.map((item) => ({
        productName: item.productName,
        brand: item.brand,
        quantity: item.quantity,
        pricePerDay: item.dailyRate,
        rentalDays: booking.dayCount || 1,
        lineTotal: item.lineRentalSubtotal,
        includedAccessories: item.included,
        units: activeUnitAssignments(unitAssignments.get(item.bookingItemId)).map((assignment) => ({
          unitCode: assignment.unitCode,
          serialNumber: assignment.serialNumber,
        })),
      })),
      startDate: booking.startDate,
      endDate: booking.endDate,
      dayCount: booking.dayCount || 1,
      fulfillmentMethod: booking.fulfillmentMethod,
      customerLocation: booking.location || "",
      currency: "PHP",
      subtotal: booking.rentalSubtotal,
      discountAmount: booking.specialDiscountAmount,
      depositAmount: booking.refundableDeposit,
      fees: booking.deliveryFee + (booking.pickupConvenienceFee ?? 0),
      finalAmount: booking.totalAmount,
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
    if (agreementError) throwSupabaseFailure("Creating the rental agreement", agreementError);
    if (!agreement) throw new Error("Creating the rental agreement returned no record.");

    const { data: agreementVersion, error: versionError } = await admin
      .from("agreement_versions")
      .insert({
        agreement_id: agreement.id,
        version_number: 1,
        status: "awaiting_business_signature",
        agreement_snapshot: toJson(agreementSnapshot),
        generated_at: now,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (versionError || !agreementVersion) {
      if (versionError) throwSupabaseFailure("Creating the agreement version", versionError);
      throw new Error("Creating the agreement version returned no record.");
    }

    // requirements_status / agreement_status are derived, not stored columns
    // on bookings anymore — nothing to update there. None of these five writes
    // read each other's results, so run them concurrently instead of as five
    // sequential round trips.
    const [
      { error: acknowledgementsError },
      { error: signatureError },
      { error: emergencyContactError },
      { error: statusHistoryError },
      { error: auditLogError },
    ] = await Promise.all([
      admin.from("agreement_acknowledgements").insert(
        (Object.keys(input.acknowledgements) as Array<keyof typeof input.acknowledgements>).map((key) => ({
          agreement_version_id: agreementVersion.id,
          user_id: user.id,
          acknowledgement_key: key,
          acknowledged: true,
          acknowledged_at: now,
        })),
      ),
      admin.from("agreement_signatures").insert({
        agreement_version_id: agreementVersion.id,
        signer_user_id: user.id,
        signer_role: "customer",
        signer_name: input.typedFullName,
        signature_path: input.files.signature,
        signature_data: { method: input.signatureMethod },
        signed_at: now,
      }),
      admin.from("booking_emergency_contacts").upsert(
        {
          booking_id: bookingId,
          full_name: input.emergencyContact.fullName,
          relationship: input.emergencyContact.relationship,
          phone_number: input.emergencyContact.phone,
          address: "",
        },
        { onConflict: "booking_id" },
      ),
      admin.from("booking_status_history").insert({
        booking_id: bookingId,
        from_status: booking.status,
        to_status: booking.status,
        note: "Customer submitted verification documents and signed the rental agreement.",
        changed_by: user.id,
      }),
      admin.rpc("log_audit_event", {
        p_action: "booking.documents_submitted",
        p_entity_type: "booking",
        p_entity_id: bookingId,
        p_booking_id: bookingId,
      }),
    ]);
    if (acknowledgementsError) {
      throwSupabaseFailure("Recording agreement acknowledgements", acknowledgementsError);
    }
    if (signatureError) throwSupabaseFailure("Recording the customer signature", signatureError);
    if (emergencyContactError) {
      throwSupabaseFailure("Recording the emergency contact", emergencyContactError);
    }
    if (statusHistoryError) throwSupabaseFailure("Recording booking history", statusHistoryError);
    if (auditLogError) throwSupabaseFailure("Recording the audit event", auditLogError);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) return errorResponse(error.message, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return errorResponse("Check the verification details and agreement, then try again.", 400);
    }
    const { bookingId } = await params;
    if (process.env.NODE_ENV !== "production") {
      console.error(`Booking document finalization failed bookingId=${bookingId}`, error);
    } else {
      console.error("Booking document finalization failed", {
        bookingId,
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return errorResponse("The documents could not be finalized. Please try again.", 500);
  }
}
