import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";
import type { CatalogEditorInput } from "@/src/services/productService";

export function parseCatalogInput(value: unknown): CatalogEditorInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("INVALID_CATALOG_INPUT");
  }
  const input = value as Record<string, unknown>;
  const string = (key: string, max: number, required = true) => {
    const result = typeof input[key] === "string" ? (input[key] as string).trim() : "";
    if (required && (!result || result.length > max)) throw new Error("INVALID_CATALOG_INPUT");
    return result.slice(0, max);
  };
  const dailyRate = Number(input.dailyRate);
  const refundableDeposit = Number(input.refundableDeposit ?? 0);
  const discountPercent = Number(input.discountPercent ?? 0);
  const totalUnits = Number(input.totalUnits);
  if (!Number.isFinite(dailyRate) || dailyRate <= 0 || dailyRate > 1_000_000) {
    throw new Error("INVALID_CATALOG_INPUT");
  }
  if (!Number.isFinite(refundableDeposit) || refundableDeposit < 0) {
    throw new Error("INVALID_CATALOG_INPUT");
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 90) {
    throw new Error("INVALID_CATALOG_INPUT");
  }
  if (!Number.isInteger(totalUnits) || totalUnits < 0 || totalUnits > 1000) {
    throw new Error("INVALID_CATALOG_INPUT");
  }
  const status = input.status;
  if (status !== "draft" && status !== "active" && status !== "inactive" && status !== "archived") {
    throw new Error("INVALID_CATALOG_INPUT");
  }
  const rawSpecifications =
    typeof input.specifications === "object" && input.specifications !== null && !Array.isArray(input.specifications)
      ? (input.specifications as Record<string, unknown>)
      : {};
  const specifications: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(rawSpecifications).slice(0, 30)) {
    const key = rawKey.trim().slice(0, 80);
    const specificationValue = typeof rawValue === "string" ? rawValue.trim().slice(0, 500) : "";
    if (key && specificationValue && !["discountPercent", "discountLabel"].includes(key)) {
      specifications[key] = specificationValue;
    }
  }

  return {
    name: string("name", 150),
    brand: string("brand", 100, false),
    category: string("category", 100),
    shortDescription: string("shortDescription", 300, false),
    description: string("description", 3000, false),
    dailyRate,
    refundableDeposit,
    discountPercent,
    discountLabel: string("discountLabel", 120, false),
    specifications,
    totalUnits,
    isFeatured: input.isFeatured === true,
    status,
  };
}

export function buildStoredSpecifications(input: CatalogEditorInput): Record<string, string> {
  const stored = { ...input.specifications };
  const included = input.specifications.included?.trim();
  if (included) stored.included = included;
  if (input.discountPercent > 0) {
    stored.discountPercent = String(input.discountPercent);
    if (input.discountLabel.trim()) stored.discountLabel = input.discountLabel.trim();
  }
  return stored;
}

function slugify(value: string, fallback: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 90);
  return `${base || fallback}-${Date.now().toString(36)}`;
}

/**
 * products.brand_id is a FK to public.brands, not a free-text column — the
 * catalog editor still collects a brand name string, so it's looked up (or
 * created on first use) by name. An empty brand name is allowed (brand_id is
 * nullable).
 */
export async function resolveBrandId(
  admin: SupabaseClient<Database>,
  brandName: string,
): Promise<string | null> {
  const trimmed = brandName.trim();
  if (!trimmed) return null;

  const { data: existing } = await admin.from("brands").select("id").ilike("name", trimmed).maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("brands")
    .insert({ name: trimmed, slug: slugify(trimmed, "brand") })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "The brand could not be created.");
  return created.id;
}

/**
 * products.category_id is a required FK to public.categories, not a
 * free-text column — same lookup-or-create pattern as resolveBrandId(), but
 * a category name is mandatory (parseCatalogInput() already enforces that).
 */
export async function resolveCategoryId(
  admin: SupabaseClient<Database>,
  categoryName: string,
): Promise<string> {
  const trimmed = categoryName.trim();
  if (!trimmed) throw new Error("INVALID_CATALOG_INPUT");

  const { data: existing } = await admin.from("categories").select("id").ilike("name", trimmed).maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("categories")
    .insert({ name: trimmed, slug: slugify(trimmed, "category") })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "The category could not be created.");
  return created.id;
}

/**
 * Adds/removes public.inventory_units rows so the physical unit count
 * matches totalUnits — the closest Postgres equivalent of the old Firestore
 * inventoryUnits reconciliation. Units beyond the new count are marked
 * 'retired' rather than deleted, to preserve any historical booking
 * references (unit_reservations.inventory_unit_id references inventory_units).
 */
export async function reconcileInventoryUnits(
  admin: SupabaseClient<Database>,
  productId: string,
  totalUnits: number,
): Promise<void> {
  const { data: units, error: unitsError } = await admin
    .from("inventory_units")
    .select("id, unit_code, lifecycle_status")
    .eq("product_id", productId)
    .order("unit_code", { ascending: true });
  if (unitsError) throw new Error(unitsError.message);

  const existing = units ?? [];
  const activeUnits = existing.filter((unit) => unit.lifecycle_status === "active");

  if (activeUnits.length < totalUnits) {
    const retiredUnits = existing.filter((unit) => unit.lifecycle_status === "retired");
    const reactivationCount = Math.min(totalUnits - activeUnits.length, retiredUnits.length);
    const toReactivate = retiredUnits.slice(0, reactivationCount);
    if (toReactivate.length > 0) {
      const { error } = await admin
        .from("inventory_units")
        .update({ lifecycle_status: "active", retired_at: null })
        .in("id", toReactivate.map((unit) => unit.id));
      if (error) throw new Error(error.message);
    }

    const createCount = totalUnits - activeUnits.length - reactivationCount;
    if (createCount > 0) {
      const usedCodes = new Set(existing.map((unit) => unit.unit_code));
      const prefix = `INV-${productId.slice(0, 8).toUpperCase()}`;
      let sequence = 1;
      const newRows = Array.from({ length: createCount }, () => {
        let unitCode = "";
        do {
          unitCode = `${prefix}-${sequence.toString().padStart(3, "0")}`;
          sequence += 1;
        } while (usedCodes.has(unitCode));
        usedCodes.add(unitCode);
        return { product_id: productId, unit_code: unitCode, lifecycle_status: "active" as const };
      });
      const { error } = await admin.from("inventory_units").insert(newRows);
      if (error) throw new Error(error.message);
    }
    return;
  }

  const retireCount = activeUnits.length - totalUnits;
  if (retireCount <= 0) return;

  const { data: heldReservations, error: reservationError } = await admin
    .from("unit_reservations")
    .select("inventory_unit_id")
    .in("inventory_unit_id", activeUnits.map((unit) => unit.id))
    .in("status", ["tentative", "confirmed", "in_use"]);
  if (reservationError) throw new Error(reservationError.message);

  const heldUnitIds = new Set((heldReservations ?? []).map((reservation) => reservation.inventory_unit_id));
  const removableUnits = activeUnits.filter((unit) => !heldUnitIds.has(unit.id)).slice(-retireCount);
  if (removableUnits.length < retireCount) throw new Error("INVENTORY_UNITS_IN_USE");

  const { error } = await admin
    .from("inventory_units")
    .update({ lifecycle_status: "retired", retired_at: new Date().toISOString().slice(0, 10) })
    .in("id", removableUnits.map((unit) => unit.id));
  if (error) throw new Error(error.message);
}
