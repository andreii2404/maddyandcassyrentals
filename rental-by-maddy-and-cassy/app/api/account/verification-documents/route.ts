import { NextResponse } from "next/server";
import { requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REUSABLE_TYPES = ["government_id", "secondary_id", "selfie_with_id"] as const;
type ReusableType = (typeof REUSABLE_TYPES)[number];

export interface ReusableVerificationDocument {
  documentId: string;
  documentType: ReusableType;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  verifiedAt: string;
}

/**
 * Returns the signed-in customer's most recently APPROVED copy of each
 * verification document (first ID, second ID, selfie with ID) so a new
 * booking can reuse them instead of demanding fresh uploads.
 *
 * A document is reusable only when:
 * - it belongs to the customer and is still "active" (not replaced/expired/deleted)
 * - at least one admin approved a submission of it on a previous booking
 * - it has no past expires_at
 */
export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    // Guest sessions have no booking history to reuse from.
    if (user.is_anonymous) {
      return NextResponse.json({ documents: [] });
    }

    const { data: documents, error } = await supabase
      .from("customer_documents")
      .select(
        "id, document_type, original_filename, mime_type, file_size_bytes, created_at, expires_at",
      )
      .eq("owner_user_id", user.id)
      .eq("status", "active")
      .in("document_type", [...REUSABLE_TYPES]);
    if (error) throw new Error(error.message);
    if (!documents?.length) {
      return NextResponse.json({ documents: [] });
    }

    const now = Date.now();
    const unexpired = documents.filter(
      (doc) => !doc.expires_at || Date.parse(doc.expires_at) > now,
    );
    if (!unexpired.length) {
      return NextResponse.json({ documents: [] });
    }

    const { data: approvals, error: approvalsError } = await supabase
      .from("booking_requirement_submissions")
      .select("customer_document_id")
      .eq("review_status", "approved")
      .in(
        "customer_document_id",
        unexpired.map((doc) => doc.id),
      );
    if (approvalsError) throw new Error(approvalsError.message);

    const approvedIds = new Set(
      (approvals ?? []).map((approval) => approval.customer_document_id),
    );

    const latestByType = new Map<ReusableType, ReusableVerificationDocument>();
    for (const doc of unexpired) {
      if (!approvedIds.has(doc.id)) continue;
      const type = doc.document_type as ReusableType;
      const existing = latestByType.get(type);
      if (!existing || Date.parse(doc.created_at) > Date.parse(existing.verifiedAt)) {
        latestByType.set(type, {
          documentId: doc.id,
          documentType: type,
          filename: doc.original_filename,
          mimeType: doc.mime_type,
          sizeBytes: doc.file_size_bytes,
          verifiedAt: doc.created_at,
        });
      }
    }

    return NextResponse.json({ documents: Array.from(latestByType.values()) });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Reusable verification document lookup failed", error);
    return NextResponse.json(
      { error: "Saved verification documents could not be looked up." },
      { status: 500 },
    );
  }
}
