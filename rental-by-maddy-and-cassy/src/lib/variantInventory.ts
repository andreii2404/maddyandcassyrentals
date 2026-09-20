import type { Product, ProductVariantAvailability } from "@/types/product";

function normalizeVariant(value?: string | null): string {
  return value?.trim().toLocaleLowerCase("en") ?? "";
}

export function findVariantAvailability(
  product: Pick<Product, "colorOptions" | "variantAvailability">,
  selectedVariant?: string | null,
): ProductVariantAvailability | undefined {
  const normalized = normalizeVariant(selectedVariant);
  if (!normalized) return undefined;
  return product.variantAvailability.find(
    (entry) => normalizeVariant(entry.variant) === normalized,
  );
}

/**
 * Maximum quantity before dates are chosen. Variant products are always
 * limited by that color's active physical units; non-variant products retain
 * the existing product-level limit.
 */
export function getVariantQuantityLimit(
  product: Pick<Product, "colorOptions" | "variantAvailability" | "totalUnits">,
  selectedVariant?: string | null,
): number {
  if (product.colorOptions.length === 0) return Math.max(0, product.totalUnits);
  return Math.max(0, findVariantAvailability(product, selectedVariant)?.totalUnits ?? 0);
}

export function isVariantSelectable(
  product: Pick<Product, "colorOptions" | "variantAvailability" | "totalUnits">,
  selectedVariant?: string | null,
): boolean {
  return getVariantQuantityLimit(product, selectedVariant) > 0;
}
