import { NextResponse } from "next/server";
import { isBookingEmailConfigured } from "@/src/lib/server/bookingStatusEmail";
import { createAdminClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    database: false,
    storage: false,
    bookingEmailConfigured: isBookingEmailConfigured(),
  };

  try {
    // public.website_content no longer exists (moved to legacy_v1_20260804
    // by the schema normalization, with no public-schema replacement) — any
    // always-present table works equally well as a plain connectivity probe.
    const admin = createAdminClient();
    const { error } = await admin.from("categories").select("id").limit(1);
    checks.database = !error;
  } catch {
    // Return a safe degraded response without exposing provider details.
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.storage.from("public-assets").list("", { limit: 1 });
    checks.storage = !error;
  } catch {
    // Return a safe degraded response without exposing provider details.
  }

  const healthy = checks.database && checks.storage;

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
