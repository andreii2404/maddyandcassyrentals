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

    // The four documents are independent of one another, so recording them as
    // two bulk inserts (instead of a per-document loop doing three sequential
    // round trips each) cuts 12 sequential DB calls down to 3. Postgres
    // preserves input order in RETURNING for a single multi-row INSERT, so
    // documentRows[i] <-> customerDocuments[i] <-> requirements[i] line up.
    const [{ data: customerDocuments, error: customerDocumentsError }, { data: requirements, error: requirementsError }] =
      await Promise.all([
        admin
          .from("customer_documents")
          .insert(
            documentRows.map((doc) => ({
              owner_user_id: user.id,
              document_type: doc.type,
              storage_bucket: "booking-documents" as const,
              storage_path: doc.path,
              original_filename: doc.name,
              status: "active" as const,
            })),
          )
          .select("id"),
        admin
          .from("booking_requirements")
          .insert(
            documentRows.map((doc) => ({
              booking_id: bookingId,
              document_type_snapshot: doc.type,
              requirement_key_snapshot: doc.type,
              requirement_name_snapshot: doc.label,
              is_required: true,
              status: "pending_review" as const,
            })),
          )
          .select("id"),
      ]);
    if (customerDocumentsError || !customerDocuments || customerDocuments.length !== documentRows.length) {
      if (customerDocumentsError) {
        throwSupabaseFailure("Recording verification documents", customerDocumentsError);
      }
      throw new Error("Recording verification documents returned an incomplete result.");
    }
    if (requirementsError || !requirements || requirements.length !== documentRows.length) {
      if (requirementsError) {
        throwSupabaseFailure("Recording booking requirements", requirementsError);
      }
      throw new Error("Recording booking requirements returned an incomplete result.");
    }

    const { error: submissionsError } = await admin.from("booking_requirement_submissions").insert(
      documentRows.map((_doc, index) => ({
        booking_requirement_id: requirements[index].id,
        customer_document_id: customerDocuments[index].id,
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
