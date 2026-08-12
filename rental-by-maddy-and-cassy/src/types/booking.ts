import type { Database } from "@/src/lib/supabase/database.types";

// Mirrors public.bookings joined with its normalized child tables
// (booking_items, booking_fulfillments, booking_requirements,
// booking_agreements, the booking_totals view) plus a profiles snapshot for
// the customer — see src/services/bookingService.ts for the assembly. The
// 2026-08-04 schema normalization removed the flat product_snapshot /
// customer_snapshot / rental_start_date / rental_end_date / requirements_status
// columns that used to live directly on bookings.

export type BookingStatus = Database["public"]["Enums"]["booking_status"];

export type FulfillmentMethod = Database["public"]["Enums"]["fulfillment_method"];

export interface BookingProductSnapshot {
  name: string;
  brand: string;
  category: string;
  image: string;
  pricePerDay: number;
  currency: string;
  included: string[];
}

export interface BookingCustomerSnapshot {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  facebookLink: string;
  instagramLink: string;
}

/**
 * Derived, not stored: summarized from public.booking_requirements rows for
 * this booking (there is no requirements_status column on bookings anymore).
 */
export type RequirementsStatus =
  | "not_submitted"
  | "pending_review"
  | "approved"
  | "rejected";

/**
 * Derived from public.booking_agreements.status; "not_created" covers the
 * case where no booking_agreements row exists yet for this booking.
 */
export type AgreementStatus = Database["public"]["Enums"]["agreement_status"] | "not_created";

export interface Booking {
  id: string;
  bookingRef: string;
  customerId: string;
  productId: string;
  inventoryUnitId: string | null;
  quantity: number;
  status: BookingStatus;
  fulfillmentMethod: FulfillmentMethod;
  startDate: string;
  endDate: string;
  nextAvailableAt?: string;
  dayCount: number;
  dailyRate: number;
  refundableDeposit: number;
  rentalSubtotal: number;
  specialDiscountAmount: number;
  birthdayDiscountAmount: number;
  birthdayDiscountStatus: "not_eligible" | "pending_verification" | "verified" | "rejected";
  loyaltyCompletedRentalsSnapshot: number;
  loyaltyDiscountAmount: number;
  loyaltyDiscountStatus: "not_eligible" | "applied" | "voided";
  birthDateSnapshot?: string;
  deliveryFee: number;
  pickupConvenienceFee?: number;
  totalAmount: number;
  location?: string;
  cityMunicipality?: string;
  province?: string;
  customerNotes?: string;
  adminNotes?: string;
  productSnapshot: BookingProductSnapshot;
  customerSnapshot: BookingCustomerSnapshot;
  requirementsStatus: RequirementsStatus;
  agreementStatus: AgreementStatus;
  approvedAt?: string;
  confirmedAt?: string;
  rejectedAt?: string;
  readyForReleaseAt?: string;
  releasedAt?: string;
  returnedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmergencyContact {
  id?: string;
  bookingId?: string;
  fullName: string;
  relationship: string;
  phoneNumber: string;
  address?: string;
}

/** One row of public.customer_documents, submitted against a booking_requirement. */
export type BookingDocumentType =
  | "government_id"
  | "secondary_id"
  | "selfie_with_id"
  | "proof_of_address"
  | "authorization_letter"
  | "other";

export type RequirementReviewStatus = "pending" | "approved" | "rejected";

/**
 * Assembled from public.booking_requirements + the customer_documents row
 * attached via its latest public.booking_requirement_submissions entry (see
 * mapRequirementToDocument in bookingDetailService.ts). There is no more
 * booking_documents table.
 */
export interface BookingDocument {
  id: string;
  bookingId: string;
  requirementId: string;
  documentType: BookingDocumentType | string;
  requirementKey?: string;
  storageBucket: string;
  storagePath: string;
  originalFilename?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  reviewStatus: RequirementReviewStatus;
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** One row of public.document_review_events — review history entry for one submission. */
export interface RequirementDocumentReview {
  id: string;
  submissionId: string;
  status: RequirementReviewStatus;
  notes?: string;
  reviewedBy?: string;
  reviewedAt: string;
  createdAt: string;
}

export interface AgreementSnapshot {
  customerName: string;
  productName: string;
  quantity?: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  fulfillmentMethod: FulfillmentMethod;
  customerLocation: string;
  pricePerDay: number;
  currency: string;
  includedAccessories: string[];
}

/** One row of public.agreement_acknowledgements. */
export type AcknowledgementKey =
  | "infoAccurate"
  | "agreedToTerms"
  | "understoodRentalRules"
  | "authorizedESignature"
  | "readPrivacyNotice"
  | "emergencyContactAuthorized";

export interface AgreementAcknowledgement {
  id: string;
  agreementVersionId: string;
  userId: string;
  acknowledgementKey: AcknowledgementKey | string;
  acknowledged: boolean;
  acknowledgedAt?: string;
}

/** One row of public.agreement_signatures (unique per agreement version + role). */
export interface AgreementSignature {
  id: string;
  agreementVersionId: string;
  signerUserId?: string;
  signerRole: "customer" | "business";
  signerName: string;
  signaturePath?: string;
  signatureData: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  signedAt: string;
}

/**
 * public.booking_agreements joined with its current public.agreement_versions
 * row — the "generated_at"/"agreement_snapshot"/document paths that used to
 * live directly on booking_agreements now live one level down, on
 * agreement_versions (see mapAgreement in bookingDetailService.ts).
 */
export interface AgreementDoc {
  id: string;
  bookingId: string;
  status: Database["public"]["Enums"]["agreement_status"];
  currentVersionId?: string;
  versionNumber?: number;
  agreementSnapshot?: AgreementSnapshot;
  generatedDocumentPath?: string;
  finalDocumentPath?: string;
  generatedAt?: string;
  completedAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  acknowledgements?: AgreementAcknowledgement[];
  signatures?: AgreementSignature[];
}

export interface StatusHistoryEntry {
  id: string;
  bookingId: string;
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  note?: string;
  changedByUserId?: string;
  createdAt: string;
}
