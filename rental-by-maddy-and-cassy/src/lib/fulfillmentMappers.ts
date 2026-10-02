import type { Tables } from "@/src/lib/supabase/database.types";
import type {
  BookingCharge,
  ChargePaymentMethod,
  ChargeType,
  CustomerUpdate,
  DepositPaymentMethod,
  FulfillmentRecord,
  ItemCondition,
  SecurityDeposit,
} from "@/src/types/fulfillment";

export function mapCharge(row: Tables<"booking_charges">): BookingCharge {
  return {
    id: row.id,
    bookingId: row.booking_id,
    chargeType: row.charge_type as ChargeType,
    amount: Number(row.amount),
    reason: row.reason,
    paymentStatus: row.payment_status === "paid" ? "paid" : "unpaid",
    paymentMethod: (row.payment_method as ChargePaymentMethod | null) ?? undefined,
    paidAt: row.paid_at ?? undefined,
    paidRecordedBy: row.paid_recorded_by ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    voidedAt: row.voided_at ?? undefined,
    voidedBy: row.voided_by ?? undefined,
    voidReason: row.void_reason ?? undefined,
  };
}

export function mapFulfillmentRecord(row: Tables<"booking_fulfillment_records">): FulfillmentRecord {
  return {
    bookingId: row.booking_id,
    pickedUp: row.picked_up,
    actualPickupAt: row.actual_pickup_at ?? undefined,
    pickupNotes: row.pickup_notes ?? undefined,
    returned: row.returned,
    actualReturnAt: row.actual_return_at ?? undefined,
    returnNotes: row.return_notes ?? undefined,
    itemCondition: (row.item_condition as ItemCondition | null) ?? null,
    conditionNotes: row.condition_notes ?? undefined,
    conditionPhotoPaths: row.condition_photo_paths ?? [],
    updatedAt: row.updated_at,
  };
}

export function mapSecurityDeposit(row: Tables<"booking_security_deposits">): SecurityDeposit {
  return {
    bookingId: row.booking_id,
    amount: Number(row.amount),
    paymentMethod: row.payment_method as DepositPaymentMethod,
    referenceNumber: row.reference_number ?? undefined,
    paidAt: row.paid_at,
    recordedBy: row.recorded_by ?? undefined,
    recordedAt: row.recorded_at,
  };
}

export function mapCustomerUpdate(row: Tables<"booking_customer_updates">): CustomerUpdate {
  return {
    id: row.id,
    bookingId: row.booking_id,
    subject: row.subject,
    message: row.message,
    sentTo: row.sent_to ?? undefined,
    sentBy: row.sent_by ?? undefined,
    adminNote: row.admin_note ?? undefined,
    relatedChargeId: row.related_charge_id ?? undefined,
    deliveryStatus: row.delivery_status === "sent" ? "sent" : "failed",
    deliveryAttempts: row.delivery_attempts,
    firstAttemptAt: row.first_attempt_at ?? undefined,
    lastAttemptAt: row.last_attempt_at ?? undefined,
    sentAt: row.sent_at ?? undefined,
    createdAt: row.created_at,
  };
}
