import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { optionalLookupUser } from "@/src/lib/server/bookingLookupSession";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import {
  BOOKING_LOOKUP_CODE_PATTERN,
  type BookingLookupResult,
} from "@/src/lib/bookingLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().trim().regex(BOOKING_LOOKUP_CODE_PATTERN),
});

const INVALID_CODE_MESSAGE =
  "That code is incorrect or has expired. Check the latest email or request a new code.";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "booking-lookup-verify", 20, 15 * 60_000);
    const parsed = verifySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter the 6-digit code from the verification email." },
        { status: 400 },
      );
    }

    const user = await optionalLookupUser();
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("redeem_booking_lookup_challenge", {
      p_challenge_id: parsed.data.challengeId,
      p_code: parsed.data.code,
      // Only an anonymous guest session can receive a guest booking.
      p_target_user_id: user?.is_anonymous ? user.id : null,
    });
    if (error) throw new Error(error.message);

    const outcome = Array.isArray(data) ? data[0] : null;
    if (!outcome || outcome.status === "invalid") {
      return NextResponse.json({ error: INVALID_CODE_MESSAGE }, { status: 400 });
    }

    if (outcome.status === "session_required") {
      // The code was correct but is not consumed yet; the client starts a
      // temporary guest session (only when signed out) and submits it again.
      return NextResponse.json(
        {
          error: "A temporary guest session is required to view this booking.",
          code: "GUEST_SESSION_REQUIRED",
        },
        { status: 409 },
      );
    }

    if (!outcome.booking_id) {
      return NextResponse.json({ error: INVALID_CODE_MESSAGE }, { status: 400 });
    }

    if (outcome.status === "guest") {
      const result: BookingLookupResult = {
        status: "open",
        path: `${bookingTrackingPath(outcome.booking_id, true)}?recovered=1`,
      };
      return NextResponse.json(result);
    }

    // Account bookings are never handed to a guest session: the owner signs in.
    if (user && !user.is_anonymous && user.id === outcome.customer_id) {
      const result: BookingLookupResult = {
        status: "open",
        path: bookingTrackingPath(outcome.booking_id, false),
      };
      return NextResponse.json(result);
    }
    const result: BookingLookupResult = {
      status: "sign_in",
      path: `/sign-in?redirect=${encodeURIComponent(bookingTrackingPath(outcome.booking_id, false))}`,
    };
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Booking lookup verification failed", error);
    return NextResponse.json(
      { error: "The code could not be verified right now. Please try again." },
      { status: 500 },
    );
  }
}
