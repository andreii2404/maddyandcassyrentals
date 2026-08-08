import { NextResponse } from "next/server";
import {
  buildStoredSpecifications,
  parseCatalogInput,
  reconcileInventoryUnits,
  resolveBrandId,
  resolveCategoryId,
} from "@/src/lib/server/catalog";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";
import { getAllProductsForAdmin, getPriceHistory } from "@/src/services/productService";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-catalog-read", 60, 60_000);
    const { supabase } = await requireActiveAdmin();

    const [products, priceHistory, categoriesResult, unitsResult, reservationsResult, reviewsResult] = await Promise.all([
      getAllProductsForAdmin(supabase),
      getPriceHistory(supabase),
      supabase.from("categories").select("id, name, slug, description, is_active, sort_order").order("sort_order"),
      supabase
        .from("inventory_units")
        .select("id, product_id, unit_code, serial_number, lifecycle_status, condition_notes, acquired_at, retired_at")
        .order("unit_code"),
      supabase
        .from("unit_reservations")
        .select("inventory_unit_id")
        .in("status", ["tentative", "confirmed", "in_use"]),
      supabase
        .from("reviews")
        .select("id, rating, comment, status, created_at, booking_items(product_id, products(name))")
        .order("created_at", { ascending: false }),
    ]);
    if (categoriesResult.error) throw new Error(categoriesResult.error.message);
    if (unitsResult.error) throw new Error(unitsResult.error.message);
    if (reservationsResult.error) throw new Error(reservationsResult.error.message);
    if (reviewsResult.error) throw new Error(reviewsResult.error.message);

    const productCountByCategory = new Map<string, number>();
    for (const product of products) {
      productCountByCategory.set(product.category, (productCountByCategory.get(product.category) ?? 0) + 1);
    }
    const categories = (categoriesResult.data ?? []).map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      isActive: category.is_active,
      sortOrder: category.sort_order,
      productCount: productCountByCategory.get(category.name) ?? 0,
    }));
    const heldUnitIds = new Set((reservationsResult.data ?? []).map((row) => row.inventory_unit_id));
    const inventoryUnits = (unitsResult.data ?? []).map((unit) => ({
      id: unit.id,
      productId: unit.product_id,
      unitCode: unit.unit_code,
      serialNumber: unit.serial_number,
      lifecycleStatus: unit.lifecycle_status,
      conditionNotes: unit.condition_notes,
      acquiredAt: unit.acquired_at,
      retiredAt: unit.retired_at,
      hasActiveReservation: heldUnitIds.has(unit.id),
    }));
    const reviews = (reviewsResult.data ?? []).map((review) => {
      const bookingItem = review.booking_items as unknown as {
        product_id: string;
        products: { name: string } | null;
      } | null;
      return {
        id: review.id,
        productId: bookingItem?.product_id ?? "",
        productName: bookingItem?.products?.name ?? "Rental item",
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        createdAt: review.created_at,
      };
    });

    return NextResponse.json({ products, priceHistory, categories, inventoryUnits, reviews });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Admin catalog read failed", error);
    return NextResponse.json({ error: "The catalog could not be loaded." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-catalog", 30, 60_000);
    const { supabase, user } = await requireActiveAdmin();
    const input = parseCatalogInput(await request.json());

    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 100);

    const [brandId, categoryId] = await Promise.all([
      resolveBrandId(supabase, input.brand),
      resolveCategoryId(supabase, input.category),
    ]);

    const { data: product, error } = await supabase
      .from("products")
      .insert({
        name: input.name,
        slug: `${slug}-${Date.now().toString(36)}`,
        brand_id: brandId,
        category_id: categoryId,
        short_description: input.shortDescription || null,
        description: input.description || null,
        daily_rate: input.dailyRate,
        refundable_deposit: input.refundableDeposit,
        status: input.status,
        is_featured: input.isFeatured,
        specifications: buildStoredSpecifications(input),
        created_by: user.id,
        updated_by: user.id,
      })
      .select("id")
      .single();

    if (error || !product) throw new Error(error?.message ?? "Product could not be created.");

    try {
      await reconcileInventoryUnits(supabase, product.id, input.totalUnits);
    } catch (inventoryError) {
      await supabase.from("products").delete().eq("id", product.id);
      throw inventoryError;
    }

    await supabase.rpc("log_audit_event", {
      p_action: "catalog.product_created",
      p_entity_type: "product",
      p_entity_id: product.id,
      p_new_values: { name: input.name, dailyRate: input.dailyRate },
    });

    return NextResponse.json({ success: true, productId: product.id }, { status: 201 });
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
    console.error("Catalog product creation failed", error);
    return NextResponse.json({ error: "The product could not be created." }, { status: 500 });
  }
}
