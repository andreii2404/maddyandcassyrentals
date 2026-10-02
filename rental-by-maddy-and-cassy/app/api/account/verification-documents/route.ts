import { NextResponse } from "next/server";
import { requireUser, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import {
  selectLatestEligibleEmergencyContact,
  selectReusableVerificationDocuments,
} from "@/src/lib/customerReservationPrefill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REUSABLE_TYPES = ["government_id", "secondary_id", "selfie_with_id", "authorization_letter"] as const;
type ReusableType = (typeof REUSABLE_TYPES)[number];

export interface ReusableVerificationDocument {
  documentId: string;
  documentType: ReusableType;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  verifiedAt: string;
}

export interface ReusableEmergencyContact {
  fullName: string;
  relationship: string;
  phone: string;
  facebookLink: string;
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
      return NextResponse.json({ documents: [], emergencyContact: null });
    }

    const { data: documents, error } = await supabase
      .from("customer_documents")
      .select(
        "id, document_type, original_filename, mime_type, file_size_bytes, created_at, expires_at, status",
      )
      .eq("owner_user_id", user.id)
      .eq("status", "active")
      .in("document_type", [...REUSABLE_TYPES]);
    if (error) throw new Error(error.message);
    const now = new Date();

    const { data: approvals, error: approvalsError } = documents.length
      ? await supabase
          .from("booking_requirement_submissions")
          .select("customer_document_id")
          .eq("review_status", "approved")
          .in(
            "customer_document_id",
            documents.map((doc) => doc.id),
          )
      : { data: [], error: null };
    if (approvalsError) throw new Error(approvalsError.message);

    const approvedIds = new Set<string>(
      (approvals ?? []).map((approval) => approval.customer_document_id),
    );

    const reusableDocuments = selectReusableVerificationDocuments(
      (documents ?? []).map((doc) => ({
        id: doc.id,
        documentType: doc.document_type,
        status: doc.status,
        expiresAt: doc.expires_at,
        createdAt: doc.created_at,
      })),
      approvedIds,
      now,
    );

    const latestByType = new Map<ReusableType, ReusableVerificationDocument>();
    for (const doc of reusableDocuments) {
      const type = doc.documentType as ReusableType;
      const source = documents?.find((candidate) => candidate.id === doc.id);
      if (!source) continue;
      const existing = latestByType.get(type);
      if (!existing || Date.parse(doc.createdAt) > Date.parse(existing.verifiedAt)) {
        latestByType.set(type, {
          documentId: doc.id,
          documentType: type,
          filename: source.original_filename,
          mimeType: source.mime_type,
          sizeBytes: source.file_size_bytes,
          verifiedAt: doc.createdAt,
        });
      }
    }

    const admin = createAdminClient();
    const { data: bookings, error: bookingsError } = await admin
      .from("bookings")
      .select("id, status, created_at")
      .eq("customer_id", user.id)
      .in("status", ["pending", "approved", "confirmed", "ready_for_release", "released", "returned"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (bookingsError) throw new Error(bookingsError.message);

    const bookingIds = (bookings ?? []).map((booking) => booking.id);
    let emergencyContact: ReusableEmergencyContact | null = null;
    if (bookingIds.length) {
      const { data: contacts, error: contactsError } = await admin
        .from("booking_emergency_contacts")
        .select("booking_id, full_name, relationship, phone_number, facebook_link")
        .in("booking_id", bookingIds);
      if (contactsError) throw new Error(contactsError.message);

      const contactByBookingId = new Map(
        (contacts ?? []).map((contact) => [contact.booking_id, {
          fullName: contact.full_name,
          relationship: contact.relationship,
          phone: contact.phone_number,
          facebookLink: contact.facebook_link ?? "",
        }]),
      );
      emergencyContact = selectLatestEligibleEmergencyContact(
        (bookings ?? []).map((booking) => ({
          status: booking.status,
          createdAt: booking.created_at,
          emergencyContact: contactByBookingId.get(booking.id) ?? null,
        })),
      );
    }

    return NextResponse.json({ documents: Array.from(latestByType.values()), emergencyContact });
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
