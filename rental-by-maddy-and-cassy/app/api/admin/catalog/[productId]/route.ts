import { NextResponse } from "next/server";
import {
  buildStoredSpecifications,
  parseCatalogInput,
  reconcileInventoryUnits,
  resolveBrandId,
  resolveCategoryId,
} from "@/src/lib/server/catalog";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-catalog", 30, 60_000);
    const { supabase, user } = await requireActiveAdmin();
    const { productId } = await params;
    const input = parseCatalogInput(await request.json());

    const { data: existing } = await supabase.from("products").select("daily_rate").eq("id", productId).maybeSingle();
    if (!existing) return NextResponse.json({ error: "The product no longer exists." }, { status: 404 });

    const [brandId, categoryId] = await Promise.all([
      resolveBrandId(supabase, input.brand),
      resolveCategoryId(supabase, input.category),
    ]);

    await reconcileInventoryUnits(supabase, productId, input.totalUnits);

    const { error } = await supabase
      .from("products")
      .update({
        name: input.name,
        brand_id: brandId,
        category_id: categoryId,
        short_description: input.shortDescription || null,
        description: input.description || null,
        daily_rate: input.dailyRate,
        refundable_deposit: input.refundableDeposit,
        status: input.status,
        is_featured: input.isFeatured,
        specifications: buildStoredSpecifications(input),
        updated_by: user.id,
      })
      .eq("id", productId);
    if (error) throw new Error(error.message);

    if (existing.daily_rate !== input.dailyRate) {
      await supabase.rpc("log_audit_event", {
        p_action: "catalog.price_changed",
        p_entity_type: "product",
        p_entity_id: productId,
        p_previous_values: { previousPrice: existing.daily_rate },
        p_new_values: { previousPrice: existing.daily_rate, newPrice: input.dailyRate, reason: "Catalog pricing update" },
      });
    }

    await supabase.rpc("log_audit_event", {
      p_action: "catalog.product_updated",
      p_entity_type: "product",
      p_entity_id: productId,
      p_new_values: { name: input.name, dailyRate: input.dailyRate, totalUnits: input.totalUnits, status: input.status },
    });

    return NextResponse.json({ success: true, productId });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "INVALID_CATALOG_INPUT") {
      return NextResponse.json({ error: "Check the product details and try again." }, { status: 400 });
    }
    if (error instanceof Error && error.message === "INVENTORY_UNITS_IN_USE") {
      return NextResponse.json({ error: "Booked units cannot be removed from active inventory." }, { status: 409 });
    }
    console.error("Catalog product update failed", error);
    return NextResponse.json({ error: "The product could not be updated." }, { status: 500 });
  }
}

/** Deactivates rather than deletes — historical bookings reference this product. */
export async function DELETE(request: Request, { params }: { params: Promise<{ productId: string }> }): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-catalog", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { productId } = await params;

    const { data: existing } = await supabase.from("products").select("name").eq("id", productId).maybeSingle();
    if (!existing) return NextResponse.json({ error: "The product no longer exists." }, { status: 404 });

    const { error } = await supabase.from("products").update({ status: "inactive" }).eq("id", productId);
    if (error) throw new Error(error.message);

    await supabase.rpc("log_audit_event", {
      p_action: "catalog.product_deactivated",
      p_entity_type: "product",
      p_entity_id: productId,
      p_new_values: { name: existing.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Catalog product deactivation failed", error);
    return NextResponse.json({ error: "The product could not be deactivated." }, { status: 500 });
  }
}
