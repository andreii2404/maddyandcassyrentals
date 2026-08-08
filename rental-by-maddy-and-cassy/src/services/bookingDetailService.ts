import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/src/lib/supabase/database.types";
import { createSignedUrl, type StorageBucket } from "@/src/lib/supabase/storage";
import { getBookingById } from "@/src/services/bookingService";
import { mapPaymentSubmission } from "@/src/services/paymentService";
import type {
  AgreementDoc,
  AgreementSignature,
  Booking,
  BookingDocument,
  EmergencyContact,
  RequirementReviewStatus,
  StatusHistoryEntry,
} from "@/src/types/booking";
import type { BookingReceipt, PaymentRecord } from "@/src/types/payment";

// There is no more booking_documents table: a document is now assembled from
// booking_requirements + its latest booking_requirement_submissions row +
// the customer_documents row that submission points to. There is also no
// more booking_invoices/invoice_line_items table.

type RequirementSubmissionRow = Pick<
  Tables<"booking_requirement_submissions">,
  "id" | "review_status" | "review_notes" | "reviewed_by" | "reviewed_at" | "submitted_at"
> & {
  customer_documents: Pick<
    Tables<"customer_documents">,
    | "document_type"
    | "storage_bucket"
    | "storage_path"
    | "original_filename"
    | "mime_type"
    | "file_size_bytes"
    | "created_at"
    | "updated_at"
  > | null;
};

type RequirementRow = Pick<
  Tables<"booking_requirements">,
  "id" | "booking_id" | "document_type_snapshot" | "requirement_key_snapshot" | "created_at" | "updated_at"
> & {
  booking_requirement_submissions: RequirementSubmissionRow[] | null;
};

/** Picks the most recently submitted attempt for a requirement, if any exists yet. */
export function mapRequirementToDocument(requirement: RequirementRow): BookingDocument | null {
  const submissions = requirement.booking_requirement_submissions ?? [];
  const latest = [...submissions].sort(
    (a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at),
  )[0];
  if (!latest) return null;

  const document = latest.customer_documents;
  return {
    id: latest.id,
    bookingId: requirement.booking_id,
    requirementId: requirement.id,
    documentType: document?.document_type ?? requirement.document_type_snapshot,
    requirementKey: requirement.requirement_key_snapshot,
    storageBucket: document?.storage_bucket ?? "",
    storagePath: document?.storage_path ?? "",
    originalFilename: document?.original_filename ?? undefined,
    mimeType: document?.mime_type ?? undefined,
    fileSizeBytes: document?.file_size_bytes ?? undefined,
    reviewStatus: latest.review_status as RequirementReviewStatus,
    reviewNotes: latest.review_notes ?? undefined,
    reviewedBy: latest.reviewed_by ?? undefined,
    reviewedAt: latest.reviewed_at ?? undefined,
    createdAt: document?.created_at ?? latest.submitted_at,
    updatedAt: document?.updated_at ?? latest.submitted_at,
  };
}

function mapAgreement(
  row: Tables<"booking_agreements">,
  currentVersion: Tables<"agreement_versions"> | undefined,
  signatures: Tables<"agreement_signatures">[],
): AgreementDoc {
  return {
    id: row.id,
    bookingId: row.booking_id,
    status: row.status,
    currentVersionId: currentVersion?.id,
    versionNumber: currentVersion?.version_number,
    agreementSnapshot: currentVersion?.agreement_snapshot as unknown as AgreementDoc["agreementSnapshot"],
    generatedDocumentPath: currentVersion?.generated_document_path ?? undefined,
    finalDocumentPath: currentVersion?.final_document_path ?? undefined,
    generatedAt: currentVersion?.generated_at ?? undefined,
    completedAt: currentVersion?.completed_at ?? row.completed_at ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    signatures: signatures.map(
      (signature): AgreementSignature => ({
        id: signature.id,
        agreementVersionId: signature.agreement_version_id,
        signerUserId: signature.signer_user_id ?? undefined,
        signerRole: signature.signer_role,
        signerName: signature.signer_name,
        signaturePath: signature.signature_path ?? undefined,
        signatureData: (signature.signature_data as Record<string, unknown>) ?? {},
        ipAddress: signature.ip_address ? String(signature.ip_address) : undefined,
        userAgent: signature.user_agent ?? undefined,
        signedAt: signature.signed_at,
      }),
    ),
  };
}

function mapStatusHistory(row: Tables<"booking_status_history">): StatusHistoryEntry {
  return {
    id: row.id,
    bookingId: row.booking_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note ?? undefined,
    changedByUserId: row.changed_by ?? undefined,
    createdAt: row.created_at,
  };
}

function mapEmergencyContact(row: Tables<"booking_emergency_contacts">): EmergencyContact {
  return {
    bookingId: row.booking_id,
    fullName: row.full_name,
    relationship: row.relationship,
    phoneNumber: row.phone_number,
    address: row.address ?? undefined,
  };
}

export interface BookingDetails {
  booking: Booking;
  emergencyContact: EmergencyContact | null;
  agreement: AgreementDoc | null;
  statusHistory: StatusHistoryEntry[];
  documents: BookingDocument[];
  payments: PaymentRecord[];
  receipts: BookingReceipt[];
  review: {
    id: string;
    rating: number;
    comment: string | null;
    status: "pending" | "approved" | "rejected";
    createdAt: string;
  } | null;
}

export async function getBookingDetails(
  supabase: SupabaseClient<Database>,
  bookingId: string,
): Promise<BookingDetails | null> {
  const booking = await getBookingById(supabase, bookingId);
  if (!booking) return null;

  const [
    { data: emergencyContact },
    { data: agreementRow },
    { data: statusHistory },
    { data: requirements },
    { data: payments },
    { data: receipts },
    { data: bookingItems },
  ] = await Promise.all([
    supabase.from("booking_emergency_contacts").select("*").eq("booking_id", bookingId).maybeSingle(),
    supabase.from("booking_agreements").select("*").eq("booking_id", bookingId).maybeSingle(),
    supabase
      .from("booking_status_history")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true }),
    supabase
      .from("booking_requirements")
      .select(
        `
          id, booking_id, document_type_snapshot, requirement_key_snapshot, created_at, updated_at,
          booking_requirement_submissions(
            id, review_status, review_notes, reviewed_by, reviewed_at, submitted_at,
            customer_documents(document_type, storage_bucket, storage_path, original_filename, mime_type, file_size_bytes, created_at, updated_at)
          )
        `,
      )
      .eq("booking_id", bookingId),
    supabase
      .from("booking_payment_submissions")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false }),
    supabase.from("booking_receipts").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false }),
    supabase
      .from("booking_items")
      .select("reviews(id, rating, comment, status, created_at)")
      .eq("booking_id", bookingId),
  ]);

  let agreement: AgreementDoc | null = null;
  if (agreementRow) {
    const { data: versions } = await supabase
      .from("agreement_versions")
      .select("*")
      .eq("agreement_id", agreementRow.id)
      .order("version_number", { ascending: false });
    const currentVersion = versions?.[0];

    let signatures: Tables<"agreement_signatures">[] = [];
    if (currentVersion) {
      const { data } = await supabase
        .from("agreement_signatures")
        .select("*")
        .eq("agreement_version_id", currentVersion.id);
      signatures = data ?? [];
    }
    agreement = mapAgreement(agreementRow, currentVersion, signatures);
  }

  const documents = ((requirements ?? []) as unknown as RequirementRow[])
    .map(mapRequirementToDocument)
    .filter((document): document is BookingDocument => document !== null);
  const reviewRow = (bookingItems?.[0]?.reviews as unknown as Array<{
    id: string;
    rating: number;
    comment: string | null;
    status: "pending" | "approved" | "rejected";
    created_at: string;
  }> | null)?.[0];

  return {
    booking,
    emergencyContact: emergencyContact ? mapEmergencyContact(emergencyContact) : null,
    agreement,
    statusHistory: (statusHistory ?? []).map(mapStatusHistory),
    documents,
    payments: (payments ?? []).map(mapPaymentSubmission),
    receipts: (receipts ?? []).map(
      (row): BookingReceipt => ({
        id: row.id,
        bookingId: row.booking_id,
        paymentSubmissionId: row.payment_submission_id ?? undefined,
        receiptNumber: row.receipt_number,
        amount: row.amount,
        issuedAt: row.issued_at,
        documentPath: row.document_path ?? undefined,
        issuedBy: row.issued_by ?? undefined,
        createdAt: row.created_at,
      }),
    ),
    review: reviewRow ? {
      id: reviewRow.id,
      rating: reviewRow.rating,
      comment: reviewRow.comment,
      status: reviewRow.status,
      createdAt: reviewRow.created_at,
    } : null,
  };
}

export async function getBookingFileUrl(
  supabase: SupabaseClient<Database>,
  bucket: StorageBucket,
  storagePath: string,
): Promise<string> {
  return createSignedUrl(supabase, bucket, storagePath);
}
