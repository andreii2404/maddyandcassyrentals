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

export type BalancePaymentPreference = "online_gcash" | "in_person";

export interface BookingProductSnapshot {
  name: string;
  brand: string;
  category: string;
  image: string;
  pricePerDay: number;
  currency: string;
  included: string[];
  /** Color variant the customer selected, when the product offers colors. */
  color?: string;
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

/** One line item of a booking -- a booking may have one or many, one per distinct product. */
export interface BookingItemLine {
  bookingItemId: string;
  productId: string;
  productName: string;
  brand: string;
  category: string;
  image: string;
  quantity: number;
  dailyRate: number;
  refundableDeposit: number;
  included: string[];
  /** dailyRate * quantity * the booking's dayCount. */
  lineRentalSubtotal: number;
  /** Count of this item's unit_reservations currently in an active status (tentative/confirmed/in_use). */
  assignedUnitCount: number;
}

export interface Booking {
  id: string;
  bookingRef: string;
  customerId: string;
  /** Snapshot of whether checkout used a temporary anonymous guest session. */
  isGuestCheckout: boolean;
  /** Every line item on this booking -- for a single-item booking, length 1. */
  items: BookingItemLine[];
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
  balancePaymentPreference: BalancePaymentPreference;
  balancePreferenceUpdatedAt?: string;
  payLaterAllowed: boolean;
  payLaterAllowedAt?: string;
  payLaterAllowedBy?: string;
  payLaterNote?: string;
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

/** One physically-assigned unit, frozen at agreement-finalization time. */
export interface AgreementUnitAssignment {
  unitCode: string;
  serialNumber: string | null;
}

/** One product line on the frozen agreement snapshot. */
export interface AgreementLineItem {
  productName: string;
  brand: string;
  quantity: number;
  pricePerDay: number;
  rentalDays: number;
  lineTotal: number;
  includedAccessories: string[];
  units: AgreementUnitAssignment[];
}

export interface AgreementSnapshot {
  customerName: string;
  /** Every product on this booking, with its assigned units frozen at signing time. */
  items: AgreementLineItem[];
  startDate: string;
  endDate: string;
  dayCount: number;
  fulfillmentMethod: FulfillmentMethod;
  customerLocation: string;
  currency: string;
  subtotal: number;
  discountAmount: number;
  depositAmount: number;
  fees: number;
  finalAmount: number;
  /** @deprecated kept only for reading legacy single-item snapshots written before the items array existed. */
  productName?: string;
  /** @deprecated see productName. */
  quantity?: number;
  /** @deprecated see productName. */
  pricePerDay?: number;
  /** @deprecated see productName. */
  includedAccessories?: string[];
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
