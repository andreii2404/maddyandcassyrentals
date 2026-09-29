import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import type { Database } from "@/src/lib/supabase/database.types";

export const runtime = "nodejs";

type PromotionUpdate = Database["public"]["Tables"]["promotions"]["Update"];

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-promotions-write", 20, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const patch: PromotionUpdate = {};
    if (typeof body.isActive === "boolean") patch.is_active = body.isActive;
    if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
    if (typeof body.description === "string") patch.description = body.description.trim() || null;
    if (typeof body.startsAt === "string") patch.starts_at = body.startsAt;
    if (typeof body.endsAt === "string") patch.ends_at = body.endsAt;
    if (Number.isFinite(Number(body.usageLimit))) patch.usage_limit = Number(body.usageLimit);
    if (body.usageLimit === null) patch.usage_limit = null;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No changes provided." }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const { error } = await supabase.from("promotions").update(patch).eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin promotion update failed", error);
    return NextResponse.json({ error: "The promotion could not be updated." }, { status: 500 });
  }
}
