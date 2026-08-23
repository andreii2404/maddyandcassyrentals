import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforceRateLimit,
  requireUser,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recoverySchema = z.object({
  bookingReference: z.string().trim().toUpperCase().regex(/^BK-[A-Z0-9]{6,20}$/),
  email: z.string().trim().toLowerCase().email().max(254),
  phoneNumber: z.string().trim().regex(/^\d{11}$/),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "guest-booking-recovery", 6, 15 * 60_000);
    const parsed = recoverySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a valid booking reference, checkout email, and 11-digit mobile number." },
        { status: 400 },
      );
    }

    const { user } = await requireUser();
    if (!user.is_anonymous) {
      return NextResponse.json(
        { error: "Guest recovery requires a temporary guest session." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    const { data: bookingId, error } = await admin.rpc("recover_guest_booking_access", {
      p_target_user_id: user.id,
      p_booking_reference: parsed.data.bookingReference,
      p_email: parsed.data.email,
      p_phone_number: parsed.data.phoneNumber,
    });

    if (error || !bookingId) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[guest booking recovery] verification failed", {
          code: error?.code,
          message: error?.message,
        });
      }
      return NextResponse.json(
        { error: "We couldn't verify that guest booking. Check the three details and try again." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, bookingId });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Guest booking recovery failed", error);
    return NextResponse.json(
      { error: "Guest booking access could not be restored. Please try again." },
      { status: 500 },
    );
  }
}
