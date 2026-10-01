import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { optionalLookupUser } from "@/src/lib/server/bookingLookupSession";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { sendEmail } from "@/src/lib/server/emailTransport";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { buildBookingLookupCodeEmail } from "@/src/lib/bookingLookupEmail";
import {
  BOOKING_LOOKUP_CODE_MINUTES,
  BOOKING_REFERENCE_PATTERN,
  normalizeBookingReference,
  type BookingLookupResult,
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

// One message for "no such booking" whoever is asking, so a lookup never
// reveals which customer (if any) owns a reference.
const NOT_FOUND_MESSAGE =
  "We couldn't find a booking with that reference. Check the reference in your confirmation email and try again.";
const ACCOUNT_NOT_FOUND_MESSAGE =
  "We couldn't find that booking in your account. If you booked as a guest, sign out and use Track Booking to verify it by email.";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "booking-lookup", 10, 15 * 60_000);
    const parsed = lookupSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a valid booking reference, such as BK-CFC07994EC." },
        { status: 400 },
      );
    }
    const bookingReference = parsed.data.bookingReference;
    const user = await optionalLookupUser();
    const admin = createAdminClient();

    // References are validated to [A-Z0-9-] above, so ilike has no wildcards
    // and only makes the match case-insensitive like the guest recovery RPC.
    const { data: bookings, error: bookingError } = await admin
      .from("bookings")
      .select("id, customer_id, is_guest_checkout, booking_reference")
      .ilike("booking_reference", bookingReference)
      .limit(1);
    if (bookingError) throw new Error(bookingError.message);
    const booking = bookings?.[0] ?? null;

    // Signed-in customers (and guests in the session that owns it) open their
    // own booking directly.
    if (user && booking && booking.customer_id === user.id) {
      const result: BookingLookupResult = {
        status: "open",
        path: bookingTrackingPath(booking.id, Boolean(user.is_anonymous)),
      };
      return NextResponse.json(result);
    }

    // Customer accounts only search their own bookings; a guest booking made
    // with another email is verified after signing out.
    if (user && !user.is_anonymous) {
      return NextResponse.json({ error: ACCOUNT_NOT_FOUND_MESSAGE }, { status: 404 });
    }

    if (!booking) {
      return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }

    // The email saved on the booking's customer profile (where guest checkout
    // keeps the guest's address), falling back to the account email.
    const { data: profile } = await admin
      .from("profiles")
      .select("contact_email")
      .eq("id", booking.customer_id)
      .maybeSingle();
    let recipient = profile?.contact_email?.trim() ?? "";
    if (!recipient) {
      const { data: owner } = await admin.auth.admin.getUserById(booking.customer_id);
      recipient = owner?.user?.email?.trim() ?? "";
    }
    if (!recipient) {
      return NextResponse.json(
        { error: "This booking can't be verified online. Please contact Rental by Maddy & Cassy for help." },
        { status: 422 },
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const { data: challengeId, error: challengeError } = await admin.rpc(
      "create_booking_lookup_challenge",
      { p_booking_id: booking.id, p_code: code },
    );
    if (challengeError || typeof challengeId !== "string") {
      if (challengeError?.message.includes("LOOKUP_COOLDOWN")) {
        return NextResponse.json(
          { error: "A code was just sent for this booking. Please wait a minute before requesting another." },
          { status: 429 },
        );
      }
      throw new Error(challengeError?.message ?? "Verification code could not be created.");
    }

    const email = buildBookingLookupCodeEmail({
      bookingReference: booking.booking_reference,
      code,
      expiresInMinutes: BOOKING_LOOKUP_CODE_MINUTES,
    });
    const sent = await sendEmail({
      to: recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `booking-lookup-${challengeId}`,
      tags: [{ name: "category", value: "booking_lookup_code" }],
      logContext: { scope: "booking-lookup", bookingId: booking.id },
    });
    if (!sent.sent) {
      // Drop the unsent code so the resend cooldown doesn't block a retry.
      await admin.from("booking_lookup_challenges").delete().eq("id", challengeId);
      if (process.env.NODE_ENV !== "production") {
        console.error("[booking lookup] verification email not sent", { reason: sent.reason });
      }
      return NextResponse.json(
        { error: "We couldn't send the verification code right now. Please try again in a few minutes." },
        { status: 503 },
      );
    }

    const result: BookingLookupResult = {
      status: "verify",
      challengeId,
      expiresInMinutes: BOOKING_LOOKUP_CODE_MINUTES,
    };
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Booking lookup failed", error);
    return NextResponse.json(
      { error: "Booking lookup is unavailable right now. Please try again." },
      { status: 500 },
    );
  }
}
