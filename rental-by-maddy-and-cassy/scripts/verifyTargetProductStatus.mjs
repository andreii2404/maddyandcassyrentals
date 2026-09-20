import assert from "node:assert/strict";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim().replace(/^"|"$/g, ""),
      ];
    }),
);

const headers = { apikey: env.SUPABASE_SECRET_KEY };

async function readTable(table, params) {
  const url = new URL(`/rest/v1/${table}`, env.NEXT_PUBLIC_SUPABASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${body}`);
  return JSON.parse(body);
}

const productNames = [
  "Insta360 X5",
  "Samsung NX Mini",
  "iPhone 17 Pro Max",
  "iPhone 13 Pro",
];

const products = await readTable("products", {
  select: "id,name,status",
  name: `in.(${productNames.map((name) => `\"${name}\"`).join(",")})`,
  order: "name.asc",
});

assert.equal(products.length, 4, "all four parent product records must exist");
const productByName = new Map(products.map((product) => [product.name, product]));

for (const name of ["Insta360 X5", "Samsung NX Mini"]) {
  assert.equal(
    productByName.get(name)?.status,
    "inactive",
    `${name} must be hidden from the active catalog`,
  );
}

for (const name of ["iPhone 17 Pro Max", "iPhone 13 Pro"]) {
  assert.equal(
    productByName.get(name)?.status,
    "active",
    `${name} must remain active so its other colors are unchanged`,
  );
}

const units = await readTable("inventory_units", {
  select: "product_id,unit_code,lifecycle_status,variant",
  product_id: `in.(${products.map((product) => product.id).join(",")})`,
  order: "unit_code.asc",
});

const unitsFor = (name) => units.filter(
  (unit) => unit.product_id === productByName.get(name)?.id,
);

for (const name of ["Insta360 X5", "Samsung NX Mini"]) {
  const productUnits = unitsFor(name);
  assert.ok(productUnits.length > 0, `${name} must retain its inventory records`);
  assert.equal(
    productUnits.some((unit) => unit.lifecycle_status === "active"),
    false,
    `${name} must have no active rental units`,
  );
}

const targetVariants = [
  ["iPhone 17 Pro Max", "Silver"],
  ["iPhone 13 Pro", "Blue"],
];

for (const [name, variant] of targetVariants) {
  const variantUnits = unitsFor(name).filter(
    (unit) => unit.variant?.trim().toLowerCase() === variant.toLowerCase(),
  );
  assert.ok(variantUnits.length > 0, `${name} ${variant} must retain its inventory record`);
  assert.equal(
    variantUnits.some((unit) => unit.lifecycle_status === "active"),
    false,
    `${name} ${variant} must have no active rental units`,
  );
}

console.log("Target long-term rentals are unavailable at both product and inventory levels.");
