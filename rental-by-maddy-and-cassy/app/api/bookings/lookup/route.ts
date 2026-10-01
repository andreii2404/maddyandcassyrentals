import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { optionalLookupUser } from "@/src/lib/server/bookingLookupSession";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import {
  BOOKING_REFERENCE_NOT_FOUND_MESSAGE,
  BOOKING_REFERENCE_PATTERN,
  buildTrackingTimeline,
  normalizeBookingReference,
  publicStatusLabel,
  publicStatusMessage,
  type PublicBookingTracking,
  type TrackingPaymentState,
} from "@/src/lib/bookingLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const lookupSchema = z.object({
  bookingReference: z
    .string()
    .max(64)
    .transform(normalizeBookingReference)
    .pipe(z.string().regex(BOOKING_REFERENCE_PATTERN)),
});

function notFound(): NextResponse {
  return NextResponse.json({ error: BOOKING_REFERENCE_NOT_FOUND_MESSAGE }, { status: 404 });
}

/**
 * Public Track Booking: anyone with a booking reference sees its progress.
 * Only the public tracking fields below are selected; customer contact
 * details, addresses, payment amounts/proofs, documents, and ids never leave
 * the server. Account-only pages keep their own sign-in checks.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "booking-lookup", 30, 15 * 60_000);
    const parsed = lookupSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return notFound();

    const admin = createAdminClient();
    // References are validated to [A-Z0-9-] above, so ilike has no wildcards
    // and only makes the match case-insensitive like the guest recovery RPC.
    const { data: bookings, error: bookingError } = await admin
      .from("bookings")
      .select(`
        id,
        customer_id,
        booking_reference,
        status,
        created_at,
        updated_at,
        pickup_at,
        return_at,
        approved_at,
        confirmed_at,
        ready_for_release_at,
        released_at,
        returned_at,
        cancelled_at,
        rejected_at,
        booking_items(product_name_snapshot, quantity, selected_variant, created_at),
        booking_fulfillments(method)
      `)
      .ilike("booking_reference", parsed.data.bookingReference)
      .limit(1);
    if (bookingError) throw new Error(bookingError.message);
    const booking = bookings?.[0] ?? null;
    // Drafts are unfinished checkouts, not submitted bookings.
    if (!booking || booking.status === "draft") return notFound();

    const { data: payments, error: paymentError } = await admin
      .from("booking_payment_submissions")
      .select("status")
      .eq("booking_id", booking.id);
    if (paymentError) {
      // The timeline still derives payment progress from the booking status.
      console.error("Booking lookup payment status unavailable", paymentError.message);
    }
    const paymentStatuses = (payments ?? []).map((payment) => payment.status);
    const paymentState: TrackingPaymentState = paymentStatuses.includes("verified")
      ? "verified"
      : paymentStatuses.some((status) => status === "submitted" || status === "under_review")
        ? "in_review"
        : "none";

    const fulfillmentMethod = booking.booking_fulfillments?.method ?? "pickup";
    // The session only decides whether to offer a direct link to the full
    // booking; tracking itself never depends on it.
    const user = await optionalLookupUser().catch(() => null);
    const detailsPath = user && user.id === booking.customer_id
      ? bookingTrackingPath(booking.id, Boolean(user.is_anonymous))
      : null;

    const result: PublicBookingTracking = {
      bookingReference: booking.booking_reference,
      status: booking.status,
      statusLabel: publicStatusLabel(booking.status, fulfillmentMethod),
      statusMessage: publicStatusMessage(booking.status, fulfillmentMethod),
      fulfillmentMethod,
      items: [...(booking.booking_items ?? [])]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((item) => ({
          name: item.product_name_snapshot,
          variant: item.selected_variant,
          quantity: item.quantity,
        })),
      pickupAt: booking.pickup_at,
      returnAt: booking.return_at,
      updatedAt: booking.updated_at,
      steps: buildTrackingTimeline({
        status: booking.status,
        fulfillmentMethod,
        paymentState,
        createdAt: booking.created_at,
        approvedAt: booking.approved_at,
        confirmedAt: booking.confirmed_at,
        readyForReleaseAt: booking.ready_for_release_at,
        releasedAt: booking.released_at,
        returnedAt: booking.returned_at,
        cancelledAt: booking.cancelled_at,
        rejectedAt: booking.rejected_at,
      }),
      detailsPath,
    };
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Booking lookup failed", error);
    return NextResponse.json(
      { error: "Booking tracking is unavailable right now. Please try again." },
      { status: 500 },
    );
  }
}
