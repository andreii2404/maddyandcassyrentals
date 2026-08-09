// Central domain-type barrel re-exporting the app's Supabase-backed domain types.

export type { Product, ProductStatus, ProductReview, ProductImage } from "@/types/product";
export type {
  Booking,
  BookingStatus,
  FulfillmentMethod,
  BookingProductSnapshot,
  BookingCustomerSnapshot,
  RequirementsStatus,
  AgreementStatus,
  EmergencyContact,
  AgreementDoc,
  AgreementSnapshot,
  AcknowledgementKey,
  AgreementAcknowledgement,
  AgreementSignature,
  StatusHistoryEntry,
  BookingDocument,
  BookingDocumentType,
  RequirementDocumentReview,
  RequirementReviewStatus,
} from "@/src/types/booking";
export type {
  PaymentSubmissionStatus,
  PaymentStage,
  PaymentOption,
  PaymentRecord,
  BookingReceipt,
  PayMongoWebhookEvent,
} from "@/src/types/payment";
export type { UserNotification, NotificationType } from "@/src/types/notification";
export type { Admin, AuditLogEntry } from "@/src/types/admin";
export type {
  InventoryUnit,
  InventoryUnitLifecycleStatus,
  AvailabilityCalendarEntry,
  ProductAvailabilitySummary,
} from "@/src/types/inventoryUnit";
export type { WebsiteContent } from "@/src/types/websiteContent";

// Legacy display-only role. Authorization decisions must go through
// public.user_roles (see private.is_admin() in the Supabase schema) —
// this field is kept for UI labeling only.
export type UserRole = "customer" | "admin";

export type AccountStatus = "active" | "suspended";

/** public.profiles, joined 1:1 with auth.users. */
export interface UserProfile {
  id: string;
  firebaseUid?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  phoneNumber?: string;
  birthDate?: string;
  birthDateVerifiedAt?: string;
  fullAddress?: string;
  facebookLink?: string;
  instagramLink?: string;
  role: UserRole;
  accountStatus: AccountStatus;
  photoPath?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * public.reviews, joined through booking_items (bookingId/productId/userId
 * are resolved via booking_item_id -> booking_items.product_id /
 * booking_items.booking_id -> bookings.customer_id — see reviewService.ts).
 */
export interface Review {
  id: string;
  bookingId: string;
  productId: string;
  userId: string;
  rating: number;
  comment?: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  moderatedAt?: string;
  moderatedBy?: string;
}
