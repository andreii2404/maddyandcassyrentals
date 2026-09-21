import type { BookingStatus } from "@/src/types/booking";
import type {
  ApprovalEmailStatus,
  BookingCharge,
  BookingEmailState,
  ChargePaymentMethod,
  ChargeType,
  CustomerUpdate,
} from "@/src/types/fulfillment";

export const FULFILLMENT_STATUSES: BookingStatus[] = [
  "approved",
  "confirmed",
  "ready_for_release",
  "released",
  "returned",
];

/** Payment submission statuses that still need an admin decision. */
export const PAYMENT_AWAITING_REVIEW_STATUSES = ["submitted", "under_review"] as const;

export const CHARGE_TYPE_LABELS: Record<ChargeType, string> = {
  late_fee: "Late Fee",
  damage_fee: "Damage Fee",
  other: "Other",
};

export const CHARGE_METHOD_LABELS: Record<ChargePaymentMethod, string> = {
  cash: "Cash",
  gcash: "GCash",
  other: "Other",
};

export const MAX_CONDITION_PHOTOS = 6;
export const MAX_CONDITION_PHOTO_BYTES = 5 * 1024 * 1024;
export const CONDITION_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

const round2 = (value: number) => Math.round(value * 100) / 100;

export function formatPhp(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * The Rental Fulfillment view replaces the review tabs once the booking is approved and its
 * confirmation email went out. Older approvals ("legacy") open it without a resend. Handed-over
 * and completed bookings always use it so a failed approval email can never strand a rental.
 */
export function isFulfillmentMode(input: {
  status: BookingStatus;
  approvalEmailStatus: ApprovalEmailStatus;
}): boolean {
  if (input.status === "released" || input.status === "returned") return true;
  if (!FULFILLMENT_STATUSES.includes(input.status)) return false;
  return input.approvalEmailStatus === "sent" || input.approvalEmailStatus === "legacy";
}

export function activeCharges(charges: BookingCharge[]): BookingCharge[] {
  return charges.filter((charge) => !charge.voidedAt);
}

export function computeAmountOwed(input: {
  totalAmount: number;
  verifiedPaid: number;
  charges: BookingCharge[];
}): { bookingBalance: number; unpaidCharges: number; totalOwed: number } {
  const rawBalance = round2(input.totalAmount - input.verifiedPaid);
  const bookingBalance = rawBalance < 0.01 ? 0 : rawBalance;
  const unpaidCharges = round2(
    activeCharges(input.charges)
      .filter((charge) => charge.paymentStatus !== "paid")
      .reduce((sum, charge) => sum + charge.amount, 0),
  );
  return { bookingBalance, unpaidCharges, totalOwed: round2(bookingBalance + unpaidCharges) };
}

export interface CompletionInput {
  status: BookingStatus;
  returned: boolean;
  itemCondition: "good" | "damaged" | null;
  charges: BookingCharge[];
  totalAmount: number;
  verifiedPaid: number;
  pendingPaymentReviews: number;
}

/** Plain-language reasons a rental cannot be completed yet. Empty means it can be. */
export function getCompletionBlockers(input: CompletionInput): string[] {
  if (input.status === "returned") return ["This rental is already completed."];
  if (input.status !== "released") return ["The item must be marked as picked up first."];

  const blockers: string[] = [];
  if (!input.returned) blockers.push("Record the item return in the Return tab.");
  if (!input.itemCondition) blockers.push("Record the item condition in the Item Condition tab.");

  const owed = computeAmountOwed({
    totalAmount: input.totalAmount,
    verifiedPaid: input.verifiedPaid,
    charges: input.charges,
  });
  if (owed.unpaidCharges > 0) {
    blockers.push(`Extra charges of ${formatPhp(owed.unpaidCharges)} are still unpaid. Mark them paid or void them.`);
  }
  if (owed.bookingBalance > 0) {
    blockers.push(`The booking still has a balance of ${formatPhp(owed.bookingBalance)}.`);
  }
  if (input.pendingPaymentReviews > 0) {
    blockers.push(
      `${input.pendingPaymentReviews} payment proof${input.pendingPaymentReviews === 1 ? " still needs" : "s still need"} review.`,
    );
  }
  return blockers;
}

export type FollowUpKind =
  | "payment_review"
  | "documents"
  | "customer_signature"
  | "countersign"
  | "confirm_booking"
  | "ready_for_handover";

export interface FollowUpItem {
  kind: FollowUpKind;
  title: string;
  detail: string;
}

export interface FollowUpInput {
  status: BookingStatus;
  pendingPaymentReviews: number;
  requirementsApproved: boolean;
  agreementStatus: string;
  canCountersign: boolean;
}

/**
 * Only unfinished items. When this returns an empty list the follow-up strip is removed
 * entirely (no "all done" placeholder).
 */
export function getFollowUpItems(input: FollowUpInput): FollowUpItem[] {
  const items: FollowUpItem[] = [];
  const activeStatus =
    input.status === "approved" ||
    input.status === "confirmed" ||
    input.status === "ready_for_release" ||
    input.status === "released";

  if (input.pendingPaymentReviews > 0 && activeStatus) {
    items.push({
      kind: "payment_review",
      title: "Payment proof needs review",
      detail: `${input.pendingPaymentReviews} payment proof${input.pendingPaymentReviews === 1 ? " is" : "s are"} waiting for a decision.`,
    });
  }

  if (input.status === "approved") {
    if (!input.requirementsApproved) {
      items.push({
        kind: "documents",
        title: "Verification documents need review",
        detail: "Every required document must be approved before the booking can be confirmed.",
      });
    }
    if (input.agreementStatus === "not_created" || input.agreementStatus === "awaiting_customer_signature") {
      items.push({
        kind: "customer_signature",
        title: "Waiting for the customer to sign",
        detail: "The rental agreement is not signed by the customer yet.",
      });
    }
    if (input.canCountersign) {
      items.push({
        kind: "countersign",
        title: "Agreement needs your signature",
        detail: "The customer has signed. Countersign to finish the agreement.",
      });
    }
    items.push({
      kind: "confirm_booking",
      title: "Confirm the booking",
      detail: "Confirm once payment, documents and the agreement are complete.",
    });
  }

  if (input.status === "confirmed") {
    items.push({
      kind: "ready_for_handover",
      title: "Mark the rental ready for handover",
      detail: "Let the customer know the rental is prepared for pickup or delivery.",
    });
  }

  return items;
}

/** Returns a plain message when the file cannot be used, otherwise null. */
export function validateConditionPhoto(file: { type: string; size: number }): string | null {
  if (!CONDITION_PHOTO_TYPES.includes(file.type)) return "Photos must be JPG, PNG or WebP images.";
  if (file.size > MAX_CONDITION_PHOTO_BYTES) return "Each photo must be 5 MB or smaller.";
  return null;
}

export interface EmailHistoryEntry {
  key: string;
  label: string;
  at?: string;
  result: "Sent" | "Not sent" | "Unavailable";
  detail?: string;
}

export function buildEmailHistory(input: {
  email: BookingEmailState;
  receipts: { id: string; receiptNumber?: string; emailedAt?: string }[];
  updates: CustomerUpdate[];
}): EmailHistoryEntry[] {
  const entries: EmailHistoryEntry[] = [];

  const approval = input.email.approvalEmailStatus;
  if (approval === "sent") {
    entries.push({ key: "approval", label: "Booking approval email", at: input.email.approvalEmailSentAt, result: "Sent" });
  } else if (approval === "failed") {
    entries.push({ key: "approval", label: "Booking approval email", result: "Not sent" });
  } else if (approval === "legacy") {
    entries.push({
      key: "approval",
      label: "Booking approval email",
      result: "Unavailable",
      detail: "Confirmation email status unavailable",
    });
  }

  for (const receipt of input.receipts) {
    if (!receipt.emailedAt) continue;
    entries.push({
      key: `receipt-${receipt.id}`,
      label: `Receipt ${receipt.receiptNumber ?? receipt.id.slice(0, 8)}`,
      at: receipt.emailedAt,
      result: "Sent",
    });
  }

  for (const update of input.updates) {
    entries.push({
      key: `update-${update.id}`,
      label: `Customer update: ${update.subject}`,
      at: update.sentAt ?? update.createdAt,
      result: update.deliveryStatus === "sent" ? "Sent" : "Not sent",
    });
  }

  if (input.email.completionEmailSentAt) {
    entries.push({
      key: "completion",
      label: "Rental completed email",
      at: input.email.completionEmailSentAt,
      result: "Sent",
      detail: input.email.completionEmailTo,
    });
  }

  return entries.sort((a, b) => Date.parse(b.at ?? "0") - Date.parse(a.at ?? "0"));
}
