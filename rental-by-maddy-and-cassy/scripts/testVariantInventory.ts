import assert from "node:assert/strict";
import test from "node:test";
import type { Product } from "../types/product";

async function loadVariantInventory() {
  try {
    return await import("../src/lib/variantInventory");
  } catch {
    return null;
  }
}

function productFixture(overrides: Record<string, unknown> = {}): Product {
  return {
    id: "product-1",
    slug: "iphone-17-pro-max",
    name: "iPhone 17 Pro Max",
    category: "Phones",
    dailyRate: 100,
    listPricePerDay: 100,
    discountPercent: 0,
    refundableDeposit: 100,
    currency: "PHP",
    status: "active",
    isFeatured: false,
    specifications: { colors: "Blue, Orange, Silver" },
    images: [],
    colorOptions: ["Blue", "Orange", "Silver"],
    variantAvailability: [
      { variant: "Blue", totalUnits: 1, availableUnits: 1 },
      { variant: "Orange", totalUnits: 1, availableUnits: 1 },
      { variant: "Silver", totalUnits: 1, availableUnits: 1 },
    ],
    totalUnits: 3,
    availableUnits: 3,
    reservedUnits: 0,
    rentedUnits: 0,
    maintenanceUnits: 0,
    rating: 0,
    reviewCount: 0,
    reviews: [],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    pricePerDay: 100,
    image: "",
    included: [],
    specs: {},
    isActive: true,
    ...overrides,
  } as unknown as Product;
}

test("a selected color uses its own unit count instead of aggregate model stock", async () => {
  const inventory = await loadVariantInventory();
  assert.ok(inventory, "variant inventory module should exist");
  assert.equal(inventory.getVariantQuantityLimit(productFixture(), "Blue"), 1);
});

test("a zero-stock color is unavailable even when another color has stock", async () => {
  const inventory = await loadVariantInventory();
  assert.ok(inventory, "variant inventory module should exist");
  const product = productFixture({
    name: "iPhone 13 Pro",
    totalUnits: 1,
    availableUnits: 1,
    colorOptions: ["Black", "Blue"],
    variantAvailability: [
      { variant: "Black", totalUnits: 1, availableUnits: 1 },
      { variant: "Blue", totalUnits: 0, availableUnits: 0 },
    ],
  });

  assert.equal(inventory.getVariantQuantityLimit(product, "Black"), 1);
  assert.equal(inventory.getVariantQuantityLimit(product, "Blue"), 0);
  assert.equal(inventory.isVariantSelectable(product, "Blue"), false);
});

test("a multi-color product cannot be added without a valid selected color", async () => {
  const inventory = await loadVariantInventory();
  assert.ok(inventory, "variant inventory module should exist");
  assert.equal(inventory.getVariantQuantityLimit(productFixture(), undefined), 0);
  assert.equal(inventory.getVariantQuantityLimit(productFixture(), "Green"), 0);
});

test("a product without variants keeps its existing aggregate stock limit", async () => {
  const inventory = await loadVariantInventory();
  assert.ok(inventory, "variant inventory module should exist");
  const product = productFixture({
    colorOptions: [],
    variantAvailability: [],
    totalUnits: 4,
    availableUnits: 4,
  });
  assert.equal(inventory.getVariantQuantityLimit(product, undefined), 4);
});
