import { createPublicClient } from "@/src/lib/supabase/public";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/src/lib/supabase/database.types";
import type { Product, ProductReview } from "@/types/product";

type ProductRow = Tables<"products"> & {
  product_images: Tables<"product_images">[] | null;
  categories: Pick<Tables<"categories">, "name"> | null;
  brands: Pick<Tables<"brands">, "name"> | null;
};

const PRODUCT_SELECT = `
  *,
  product_images(*),
  categories(name),
  brands(name)
`;

/**
 * Customers can't SELECT inventory_units/unit_reservations directly (admin-only
 * RLS), so the active unit count comes from the get_product_availability() RPC —
 * the same SECURITY DEFINER function the booking flow uses. total_units is
 * date-independent (it's just the count of active inventory_units), so catalog
 * display uses it for both totalUnits and availableUnits: catalog availability
 * represents whether the product has rentable inventory at all, not whether a
 * reservation happens to overlap today. Real per-date availability is checked
 * separately (get_product_availability / get_product_multi_day_time_availability)
 * once the customer picks rental dates.
 */
async function fetchAvailabilitySnapshot(
  supabase: SupabaseClient<Database>,
  productId: string,
): Promise<{ totalUnits: number; availableUnits: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("get_product_availability", {
    p_product_id: productId,
    p_start_date: today,
    p_end_date: today,
  });
  if (error) throw new Error(error.message);
  const totalUnits = data?.[0]?.total_units ?? 0;
  return { totalUnits, availableUnits: totalUnits };
}

/** Reviews are keyed off booking_items now, not products directly, so they're
 * fetched via the get_product_reviews() RPC (already filtered to approved). */
async function fetchApprovedReviews(
  supabase: SupabaseClient<Database>,
  productId: string,
): Promise<ProductReview[]> {
  const { data, error } = await supabase.rpc("get_product_reviews", {
    p_product_id: productId,
    p_limit: 100,
    p_offset: 0,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((review) => ({
    id: review.review_id,
    author: "Verified renter",
    rating: review.rating,
    comment: review.comment ?? "",
    date: review.created_at,
  }));
}

async function mapProduct(
  supabase: SupabaseClient<Database>,
  row: ProductRow,
): Promise<Product> {
  const [{ totalUnits, availableUnits }, reviews] = await Promise.all([
    fetchAvailabilitySnapshot(supabase, row.id),
    fetchApprovedReviews(supabase, row.id),
  ]);

  const images = (row.product_images ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
    .map((image) => ({
      id: image.id,
      storagePath: image.storage_path,
      url: supabase.storage.from("product-images").getPublicUrl(image.storage_path).data.publicUrl,
      altText: image.alt_text ?? undefined,
      sortOrder: image.sort_order,
      isPrimary: image.is_primary,
    }));

  const rating = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : 0;

  const specifications = (row.specifications as Record<string, string>) ?? {};
  const {
    included: includedText,
    discountPercent: discountPercentText,
    discountLabel,
    ...displaySpecifications
  } = specifications;
  const included = includedText
    ? includedText.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  const parsedDiscount = Number(discountPercentText ?? 0);
  const discountPercent = Number.isFinite(parsedDiscount)
    ? Math.min(Math.max(parsedDiscount, 0), 90)
    : 0;
  const discountedDailyRate = Math.round(row.daily_rate * (1 - discountPercent / 100) * 100) / 100;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brands?.name ?? undefined,
    category: row.categories?.name ?? "",
    shortDescription: row.short_description ?? undefined,
    description: row.description ?? undefined,
    dailyRate: row.daily_rate,
    listPricePerDay: row.daily_rate,
    discountPercent,
    discountLabel: discountLabel || undefined,
    refundableDeposit: row.refundable_deposit,
    currency: "PHP",
    status: row.status as Product["status"],
    isFeatured: row.is_featured,
    specifications,
    images,
    totalUnits,
    availableUnits,
    reservedUnits: Math.max(totalUnits - availableUnits, 0),
    rentedUnits: 0,
    maintenanceUnits: 0,
    rating,
    reviewCount: reviews.length,
    reviews,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pricePerDay: discountedDailyRate,
    image: images[0]?.url || "/images/product-placeholder.png",
    included,
    badge: discountPercent > 0 ? `${discountPercent}% OFF` : row.is_featured ? "Featured" : undefined,
    specs: displaySpecifications,
    isActive: row.status === "active",
  };
}

export async function getActiveProducts(): Promise<Product[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return Promise.all(((data ?? []) as unknown as ProductRow[]).map((row) => mapProduct(supabase, row)));
}

/** Accepts either the product UUID or its slug (catalog links use slugs). */
export async function getProductById(idOrSlug: string): Promise<Product | null> {
  const supabase = createPublicClient();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq(isUuid ? "id" : "slug", idOrSlug)
    .maybeSingle();

  if (error || !data) return null;
  return await mapProduct(supabase, data as unknown as ProductRow);
}

/** Admin catalog list — pass a session-bound client so RLS reveals non-active products too. */
export async function getAllProductsForAdmin(
  supabase: SupabaseClient<Database>,
): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return Promise.all(((data ?? []) as unknown as ProductRow[]).map((row) => mapProduct(supabase, row)));
}

export interface CatalogEditorInput {
  name: string;
  brand: string;
  category: string;
  shortDescription?: string;
  description: string;
  dailyRate: number;
  refundableDeposit: number;
  discountPercent: number;
  discountLabel: string;
  specifications: Record<string, string>;
  totalUnits: number;
  isFeatured: boolean;
  status: Product["status"];
}

async function adminCatalogRequest<T = void>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  input?: CatalogEditorInput,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: input ? { "Content-Type": "application/json" } : undefined,
    body: input ? JSON.stringify(input) : undefined,
  });
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json().catch(() => undefined)) as T;
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(
    typeof body?.error === "string" ? body.error : "The catalog change could not be saved.",
  );
}

export async function createCatalogProductAsAdmin(input: CatalogEditorInput): Promise<string> {
  const result = await adminCatalogRequest<{ productId: string }>("/api/admin/catalog", "POST", input);
  return result.productId;
}

export async function updateCatalogProductAsAdmin(
  productId: string,
  input: CatalogEditorInput,
): Promise<void> {
  return adminCatalogRequest(`/api/admin/catalog/${encodeURIComponent(productId)}`, "PATCH", input);
}

export async function deactivateCatalogProductAsAdmin(productId: string): Promise<void> {
  return adminCatalogRequest(`/api/admin/catalog/${encodeURIComponent(productId)}`, "DELETE");
}

async function adminJsonRequest(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.ok) return;
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(result?.error || "The catalog change could not be saved.");
}

export interface CatalogCategoryInput {
  name: string;
  description: string;
  sortOrder: number;
}

export function createCatalogCategoryAsAdmin(input: CatalogCategoryInput): Promise<void> {
  return adminJsonRequest("/api/admin/catalog/categories", "POST", input);
}

export function updateCatalogCategoryAsAdmin(categoryId: string, input: CatalogCategoryInput): Promise<void> {
  return adminJsonRequest(`/api/admin/catalog/categories/${encodeURIComponent(categoryId)}`, "PATCH", input);
}

export function deleteCatalogCategoryAsAdmin(categoryId: string): Promise<void> {
  return adminJsonRequest(`/api/admin/catalog/categories/${encodeURIComponent(categoryId)}`, "DELETE");
}

export interface InventoryUnitEditorInput {
  unitCode: string;
  serialNumber: string;
  lifecycleStatus: "active" | "maintenance" | "retired";
  conditionNotes: string;
  acquiredAt: string;
}

export function updateInventoryUnitAsAdmin(unitId: string, input: InventoryUnitEditorInput): Promise<void> {
  return adminJsonRequest(`/api/admin/catalog/units/${encodeURIComponent(unitId)}`, "PATCH", input);
}

export function moderateProductReviewAsAdmin(
  reviewId: string,
  status: "approved" | "rejected",
): Promise<void> {
  return adminJsonRequest(`/api/admin/catalog/reviews/${encodeURIComponent(reviewId)}`, "PATCH", { status });
}

export async function uploadCatalogImage(
  productId: string,
  file: File,
): Promise<{ storagePath: string; url: string }> {
  const form = new FormData();
  form.set("image", file);
  const response = await fetch(`/api/admin/catalog/${encodeURIComponent(productId)}/images`, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const body = (await response.json().catch(() => null)) as
    | { storagePath?: string; url?: string; error?: string }
    | null;
  if (!response.ok || !body?.storagePath || !body.url) {
    throw new Error(body?.error || "The product image could not be uploaded.");
  }
  return { storagePath: body.storagePath, url: body.url };
}

export interface PriceHistoryEntry {
  id: string;
  productId: string;
  previousPrice: number | null;
  newPrice: number;
  changedBy: string | null;
  reason: string;
  createdAt: string;
}

/** Price changes are recorded as audit_logs rows (action = "catalog.price_changed"). */
export async function getPriceHistory(
  supabase: SupabaseClient<Database>,
): Promise<PriceHistoryEntry[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, entity_id, actor_user_id, previous_values, new_values, metadata, created_at")
    .eq("entity_type", "product")
    .eq("action", "catalog.price_changed")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const metadata = (row.metadata as Record<string, unknown>) ?? {};
    const previousValues = (row.previous_values as Record<string, unknown>) ?? {};
    const newValues = (row.new_values as Record<string, unknown>) ?? {};
    return {
      id: row.id,
      productId: row.entity_id ?? "",
      previousPrice: typeof previousValues.previousPrice === "number"
        ? previousValues.previousPrice
        : typeof metadata.previousPrice === "number"
          ? metadata.previousPrice
          : null,
      newPrice: typeof newValues.newPrice === "number"
        ? newValues.newPrice
        : typeof metadata.newPrice === "number"
          ? metadata.newPrice
          : 0,
      changedBy: row.actor_user_id,
      reason: typeof newValues.reason === "string"
        ? newValues.reason
        : typeof metadata.reason === "string"
          ? metadata.reason
          : "",
      createdAt: row.created_at,
    };
  });
}
