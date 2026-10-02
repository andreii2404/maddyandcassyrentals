import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Product } from "../types/product";

async function loadVariantInventory() {
  try {
    return await import("../src/lib/variantInventory");
  } catch {
    return null;
  }
}

async function loadProductVariantOptions() {
  try {
    return await import("../src/lib/productVariantOptions");
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

test("restored quantities are capped by the current inventory limit", async () => {
  const inventory = await loadVariantInventory();
  assert.ok(inventory, "variant inventory module should exist");
  assert.equal(inventory.clampQuantityToInventory(3, 1), 1);
  assert.equal(inventory.clampQuantityToInventory(1, 4), 1);
});

test("legacy singular Color metadata is treated as one selectable variant", async () => {
  const options = await loadProductVariantOptions();
  assert.ok(options, "product variant options module should exist");
  assert.deepEqual(options.getProductColorOptions({ Color: "White", Storage: "128 GB" }), ["White"]);
});

test("single-item booking RPC treats an empty variant as null", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260928125210_fix_non_variant_single_booking_wrapper.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /v_variant\s*:=\s*nullif\(trim\(v_variant\),\s*''\)/);
});

test("a requested reservation color resolves to the product's own color option", async () => {
  const inventory = await loadVariantInventory();
  assert.ok(inventory, "variant inventory module should exist");
  const product = productFixture();
  assert.equal(inventory.resolveRequestedColor(product, "Orange"), "Orange");
  assert.equal(inventory.resolveRequestedColor(product, " orange "), "Orange");
  assert.equal(inventory.resolveRequestedColor(product, "Purple"), undefined);
  assert.equal(inventory.resolveRequestedColor(product, ""), undefined);
  assert.equal(inventory.resolveRequestedColor(product, null), undefined);
  assert.equal(inventory.resolveRequestedColor(product, undefined), undefined);
});

test("a single-color product always reserves its only color", async () => {
  const inventory = await loadVariantInventory();
  assert.ok(inventory, "variant inventory module should exist");
  const product = productFixture({ colorOptions: ["White"] });
  assert.equal(inventory.resolveRequestedColor(product, undefined), "White");
  assert.equal(inventory.resolveRequestedColor(product, "white"), "White");
});

test("a product without color options never carries a reservation color", async () => {
  const inventory = await loadVariantInventory();
  assert.ok(inventory, "variant inventory module should exist");
  const product = productFixture({ colorOptions: [], variantAvailability: [] });
  assert.equal(inventory.resolveRequestedColor(product, "Blue"), undefined);
});

test("the reserve page takes its color from the server request, not window.location", () => {
  const client = readFileSync(new URL("../app/catalog/[id]/reserve/ReserveFlowClient.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/catalog/[id]/reserve/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(client, /searchParams?\)?\.get\("color"\)|\.get\("color"\)/);
  assert.match(client, /resolveRequestedColor\(product, requestedColor\)/);
  assert.match(page, /requestedColor=/);
});
