import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCharge, mapFulfillmentRecord } from "@/src/lib/fulfillmentMappers";
import { PAYMENT_AWAITING_REVIEW_STATUSES, type CompletionInput } from "@/src/lib/rentalFulfillment";
import type { Database } from "@/src/lib/supabase/database.types";
import { getBookingById } from "@/src/services/bookingService";

/** Loads everything getCompletionBlockers needs. Returns null when the booking does not exist. */
export async function loadCompletionInputs(
  admin: SupabaseClient<Database>,
  bookingId: string,
): Promise<CompletionInput | null> {
  const booking = await getBookingById(admin, bookingId);
  if (!booking) return null;

  const [recordResult, chargesResult, paymentsResult] = await Promise.all([
    admin.from("booking_fulfillment_records").select("*").eq("booking_id", bookingId).maybeSingle(),
    admin.from("booking_charges").select("*").eq("booking_id", bookingId),
    admin.from("booking_payment_submissions").select("declared_amount, status").eq("booking_id", bookingId),
  ]);
  if (recordResult.error || chargesResult.error || paymentsResult.error) {
    throw new Error(
      recordResult.error?.message ?? chargesResult.error?.message ?? paymentsResult.error?.message ?? "load failed",
    );
  }

  const record = recordResult.data ? mapFulfillmentRecord(recordResult.data) : null;
  const payments = paymentsResult.data ?? [];
  return {
    status: booking.status,
    pickedUp: record?.pickedUp ?? false,
    returned: record?.returned ?? false,
    itemCondition: record?.itemCondition ?? null,
    charges: (chargesResult.data ?? []).map(mapCharge),
    totalAmount: booking.totalAmount,
    verifiedPaid: payments.filter((row) => row.status === "verified").reduce((sum, row) => sum + row.declared_amount, 0),
    pendingPaymentReviews: payments.filter((row) =>
      (PAYMENT_AWAITING_REVIEW_STATUSES as readonly string[]).includes(row.status),
    ).length,
  };
}
