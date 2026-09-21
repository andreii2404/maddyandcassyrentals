import type { BookingStatus } from "@/src/types/booking";

export type ApprovalEmailStatus = "sent" | "failed" | "legacy" | null;
export type ItemCondition = "good" | "damaged";
export type ChargeType = "late_fee" | "damage_fee" | "other";
export type ChargePaymentMethod = "cash" | "gcash" | "other";

export interface BookingEmailState {
  approvalEmailStatus: ApprovalEmailStatus;
  approvalEmailSentAt?: string;
  completionEmailSentAt?: string;
  completionEmailTo?: string;
}

export interface FulfillmentRecord {
  bookingId: string;
  pickedUp: boolean;
  actualPickupAt?: string;
  pickupNotes?: string;
  returned: boolean;
  actualReturnAt?: string;
  returnNotes?: string;
  itemCondition: ItemCondition | null;
  conditionNotes?: string;
  conditionPhotoPaths: string[];
  updatedAt: string;
}

export interface BookingCharge {
  id: string;
  bookingId: string;
  chargeType: ChargeType;
  amount: number;
  reason: string;
  paymentStatus: "unpaid" | "paid";
  paymentMethod?: ChargePaymentMethod;
  paidAt?: string;
  paidRecordedBy?: string;
  createdBy?: string;
  createdAt: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
}

export interface CustomerUpdate {
  id: string;
  bookingId: string;
  subject: string;
  message: string;
  sentTo?: string;
  sentBy?: string;
  adminNote?: string;
  relatedChargeId?: string;
  deliveryStatus: "sent" | "failed";
  deliveryAttempts: number;
  firstAttemptAt?: string;
  lastAttemptAt?: string;
  sentAt?: string;
  createdAt: string;
}

export interface FulfillmentData {
  /** False when the fulfillment tables/columns are not available yet; the old review UI is used. */
  available: boolean;
  email: BookingEmailState;
  record: FulfillmentRecord | null;
  charges: BookingCharge[];
  updates: CustomerUpdate[];
  /** Admin user id to display name, for "recorded by" labels. */
  adminNames: Record<string, string>;
}

export const EMPTY_FULFILLMENT_DATA: FulfillmentData = {
  available: false,
  email: { approvalEmailStatus: null },
  record: null,
  charges: [],
  updates: [],
  adminNames: {},
};

/** Everything a fulfillment tab panel needs about the booking. */
export interface FulfillmentPanelContext {
  bookingId: string;
  bookingRef: string;
  status: BookingStatus;
  customerName: string;
  customerEmail: string;
  isGuest: boolean;
  totalAmount: number;
  verifiedPaid: number;
  pendingPaymentReviews: number;
  payLaterAllowed: boolean;
  /** True when the balance is paid or a pay-later exception is approved (mirrors the handover guard). */
  handoverPaymentReady: boolean;
  releasedAt?: string;
  data: FulfillmentData;
  /** Reloads the booking page data after a change. */
  onChanged: () => Promise<void>;
}
