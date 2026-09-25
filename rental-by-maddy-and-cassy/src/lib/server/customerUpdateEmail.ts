import "server-only";

import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { buildCustomerUpdateEmail } from "@/src/lib/customerUpdateEmailContent";
import { mapCharge } from "@/src/lib/fulfillmentMappers";
import { CHARGE_TYPE_LABELS } from "@/src/lib/rentalFulfillment";
import { resolveBookingRecipientEmail } from "@/src/lib/server/bookingRecipient";
import { safeTagValue, sendEmail, type EmailSendResult } from "@/src/lib/server/emailTransport";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getBookingById } from "@/src/services/bookingService";

export interface CustomerUpdateDeliveryOutcome {
  delivered: boolean;
  emailedTo?: string;
  reason?: EmailSendResult["reason"] | "not_found" | "already_sent" | "load_failed";
}

/**
 * Emails one stored customer update and records the attempt on the same row. Used for the first
 * send and for every resend, so a retry never creates a second update or touches any charge.
 * Never throws.
 */
export async function deliverCustomerUpdate({
  updateId,
  origin,
}: {
  updateId: string;
  origin: string;
}): Promise<CustomerUpdateDeliveryOutcome> {
  try {
    const admin = createAdminClient();
    const { data: update, error } = await admin
      .from("booking_customer_updates")
      .select("*")
      .eq("id", updateId)
      .maybeSingle();
    if (error) {
      console.error("Customer update could not be loaded", { updateId, error: error.message });
      return { delivered: false, reason: "load_failed" };
    }
    if (!update) return { delivered: false, reason: "not_found" };
    if (update.delivery_status === "sent") return { delivered: false, reason: "already_sent" };

    const booking = await getBookingById(admin, update.booking_id);
    if (!booking) return { delivered: false, reason: "not_found" };

    let charge: { label: string; amount: number; paid: boolean } | undefined;
    if (update.related_charge_id) {
      const { data: chargeRow } = await admin
        .from("booking_charges")
        .select("*")
        .eq("id", update.related_charge_id)
        .eq("booking_id", update.booking_id)
        .maybeSingle();
      if (chargeRow) {
        const mapped = mapCharge(chargeRow);
        charge = {
          label: CHARGE_TYPE_LABELS[mapped.chargeType],
          amount: mapped.amount,
          paid: mapped.paymentStatus === "paid",
        };
      }
    }

    const customerEmail = await resolveBookingRecipientEmail(admin, booking);
    const email = buildCustomerUpdateEmail({
      bookingReference: booking.bookingRef,
      customerName: booking.customerSnapshot.fullName.trim() || "Customer",
      subject: update.subject,
      message: update.message,
      bookingUrl: `${origin}${bookingTrackingPath(booking.id, booking.isGuestCheckout)}`,
      isGuest: booking.isGuestCheckout,
      charge,
    });

    const attempt = update.delivery_attempts + 1;
    const result = await sendEmail({
      to: customerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `booking-update-${update.id}-${attempt}`,
      tags: [
        { name: "booking_status", value: "customer_update" },
        { name: "booking_reference", value: safeTagValue(booking.bookingRef) },
      ],
      logContext: { bookingId: booking.id, updateId: update.id },
    });

    const now = new Date().toISOString();
    const { error: saveError } = await admin
      .from("booking_customer_updates")
      .update({
        delivery_attempts: attempt,
        first_attempt_at: update.first_attempt_at ?? now,
        last_attempt_at: now,
        ...(result.sent ? { delivery_status: "sent", sent_at: now, sent_to: customerEmail } : {}),
      })
      .eq("id", update.id);
    if (saveError) {
      console.error("Customer update result could not be saved", { updateId, error: saveError.message });
    }

    return result.sent
      ? { delivered: true, emailedTo: customerEmail }
      : { delivered: false, reason: result.reason };
  } catch (error) {
    console.error("Customer update failed unexpectedly", {
      updateId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return { delivered: false, reason: "load_failed" };
  }
}
