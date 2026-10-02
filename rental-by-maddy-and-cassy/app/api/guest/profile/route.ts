import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireUser,
  RequestSecurityError,
} from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Guarantees the caller's anonymous (guest) session has the `profiles` and
 * `user_roles` rows the rest of checkout depends on. A guest session can
 * outlive its profile row (for example after the profiles table was cleaned),
 * and public.save_guest_checkout_contact() only UPDATEs, so without this the
 * payment step fails with CUSTOMER_PROFILE_REQUIRED. Idempotent: existing rows
 * are never modified, so reusing a valid guest session is always safe.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "guest-profile-ensure", 30, 60_000);

    const { user } = await requireUser();
    if (!user.is_anonymous) {
      return NextResponse.json(
        { error: "Guest checkout requires a temporary guest session." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    const { error: profileError } = await admin
      .from("profiles")
      .upsert(
        { id: user.id, display_name: "Customer", is_guest_contact: true },
        { onConflict: "id", ignoreDuplicates: true },
      );
    if (profileError) throw profileError;

    const { error: roleError } = await admin
      .from("user_roles")
      .upsert(
        { user_id: user.id, role: "customer" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (roleError) throw roleError;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Guest profile preparation failed", error);
    return NextResponse.json(
      { error: "Your guest checkout session could not be prepared. Please try again." },
      { status: 500 },
    );
  }
}
