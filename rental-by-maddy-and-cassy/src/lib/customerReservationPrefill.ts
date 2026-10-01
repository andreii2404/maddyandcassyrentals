export interface EmergencyContactInput {
  fullName: string;
  relationship: string;
  phone: string;
  facebookLink: string;
}

export interface EmergencyContactPersistenceInput extends EmergencyContactInput {
  idDocumentId: string;
}

export interface EmergencyContactPersistencePayload {
  booking_id: string;
  full_name: string;
  relationship: string;
  phone_number: string;
  facebook_link: string;
  id_document_id: string;
  address: string;
}

export function buildEmergencyContactPersistencePayload(
  bookingId: string,
  input: EmergencyContactPersistenceInput,
): EmergencyContactPersistencePayload {
  return {
    booking_id: bookingId,
    full_name: input.fullName,
    relationship: input.relationship,
    phone_number: input.phone,
    facebook_link: input.facebookLink,
    id_document_id: input.idDocumentId,
    address: "",
  };
}

export type EmergencyContactPrefill = EmergencyContactInput;

interface BookingContactCandidate {
  status: string;
  createdAt: string;
  emergencyContact: EmergencyContactPrefill | null;
}

const ELIGIBLE_BOOKING_STATUSES = new Set([
  "pending",
  "approved",
  "confirmed",
  "ready_for_release",
  "released",
  "returned",
]);

export function selectLatestEligibleEmergencyContact(
  candidates: BookingContactCandidate[],
): EmergencyContactPrefill | null {
  return (
    candidates
      .filter((candidate) => ELIGIBLE_BOOKING_STATUSES.has(candidate.status) && candidate.emergencyContact)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
      ?.emergencyContact ?? null
  );
}

export interface ReusableVerificationDocumentCandidate {
  id: string;
  documentType: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

export function selectReusableVerificationDocuments(
  documents: ReusableVerificationDocumentCandidate[],
  approvedIds: Set<string>,
  now = new Date(),
): ReusableVerificationDocumentCandidate[] {
  const latestByType = new Map<string, ReusableVerificationDocumentCandidate>();
  for (const document of documents) {
    if (
      document.status !== "active" ||
      (document.expiresAt !== null && Date.parse(document.expiresAt) <= now.getTime()) ||
      !approvedIds.has(document.id)
    ) {
      continue;
    }
    const previous = latestByType.get(document.documentType);
    if (!previous || Date.parse(document.createdAt) > Date.parse(previous.createdAt)) {
      latestByType.set(document.documentType, document);
    }
  }
  return [...latestByType.values()];
}

export function hasFreshDocumentSlots(slots: unknown[]): boolean {
  return slots.length > 0;
}
