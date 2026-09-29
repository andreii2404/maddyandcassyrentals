import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

function deriveStatus(promo: { is_active: boolean; starts_at: string; ends_at: string }): string {
  if (!promo.is_active) return "inactive";
  const now = Date.now();
  if (now < new Date(promo.starts_at).getTime()) return "scheduled";
  if (now > new Date(promo.ends_at).getTime()) return "expired";
  return "active";
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-promotions-read", 60, 60_000);
    const { supabase } = await requireActiveAdmin();

    const [promotionsResult, redemptionsResult] = await Promise.all([
      supabase.from("promotions").select("*").order("created_at", { ascending: false }),
      supabase.from("promotion_redemptions").select("promotion_id, discount_amount"),
    ]);
    if (promotionsResult.error) throw new Error(promotionsResult.error.message);
    if (redemptionsResult.error) throw new Error(redemptionsResult.error.message);

    const redemptionsByPromotion = new Map<string, { count: number; totalDiscount: number }>();
    for (const row of redemptionsResult.data ?? []) {
      const existing = redemptionsByPromotion.get(row.promotion_id) ?? { count: 0, totalDiscount: 0 };
      existing.count += 1;
      existing.totalDiscount += Number(row.discount_amount);
      redemptionsByPromotion.set(row.promotion_id, existing);
    }

    const promotions = (promotionsResult.data ?? []).map((promo) => ({
      ...promo,
      status: deriveStatus(promo),
      redemptionCount: redemptionsByPromotion.get(promo.id)?.count ?? 0,
      totalDiscountGiven: redemptionsByPromotion.get(promo.id)?.totalDiscount ?? 0,
    }));

    return NextResponse.json({ promotions });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin promotions read failed", error);
    return NextResponse.json({ error: "Promotions could not be loaded." }, { status: 500 });
  }
}

interface CreatePromotionInput {
  code: string;
  title: string;
  description?: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  maxDiscountAmount?: number | null;
  minSubtotal?: number;
  startsAt: string;
  endsAt: string;
  usageLimit?: number | null;
  perCustomerLimit?: number;
}

function parseCreateInput(body: unknown): CreatePromotionInput {
  if (!body || typeof body !== "object") throw new Error("INVALID_PROMOTION_INPUT");
  const input = body as Record<string, unknown>;
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const discountType = input.discountType === "fixed" ? "fixed" : input.discountType === "percentage" ? "percentage" : null;
  const discountValue = Number(input.discountValue);
  const startsAt = typeof input.startsAt === "string" ? input.startsAt : "";
  const endsAt = typeof input.endsAt === "string" ? input.endsAt : "";

  if (!code || !title || !discountType || !Number.isFinite(discountValue) || discountValue <= 0 || !startsAt || !endsAt) {
    throw new Error("INVALID_PROMOTION_INPUT");
  }
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new Error("INVALID_PROMOTION_INPUT");
  }

  return {
    code,
    title,
    description: typeof input.description === "string" ? input.description.trim() || undefined : undefined,
    discountType,
    discountValue,
    maxDiscountAmount: Number.isFinite(Number(input.maxDiscountAmount)) ? Number(input.maxDiscountAmount) : null,
    minSubtotal: Number.isFinite(Number(input.minSubtotal)) ? Number(input.minSubtotal) : 0,
    startsAt,
    endsAt,
    usageLimit: Number.isFinite(Number(input.usageLimit)) && Number(input.usageLimit) > 0 ? Number(input.usageLimit) : null,
    perCustomerLimit: Number.isFinite(Number(input.perCustomerLimit)) && Number(input.perCustomerLimit) > 0 ? Number(input.perCustomerLimit) : 1,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-promotions-write", 20, 60_000);
    const { supabase, user } = await requireActiveAdmin();
    const input = parseCreateInput(await request.json());

    const { data, error } = await supabase
      .from("promotions")
      .insert({
        code: input.code,
        title: input.title,
        description: input.description ?? null,
        discount_type: input.discountType,
        discount_value: input.discountValue,
        max_discount_amount: input.maxDiscountAmount,
        min_subtotal: input.minSubtotal,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        usage_limit: input.usageLimit,
        per_customer_limit: input.perCustomerLimit,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        return NextResponse.json({ error: "A promotion with this code already exists." }, { status: 409 });
      }
      throw new Error(error?.message ?? "Promotion could not be created.");
    }

    return NextResponse.json({ success: true, promotionId: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "INVALID_PROMOTION_INPUT") {
      return NextResponse.json({ error: "Check the promotion details and try again." }, { status: 400 });
    }
    console.error("Admin promotion creation failed", error);
    return NextResponse.json({ error: "The promotion could not be created." }, { status: 500 });
  }
}
