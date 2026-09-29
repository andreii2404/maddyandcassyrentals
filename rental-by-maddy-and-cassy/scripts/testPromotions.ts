import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929090000_promotions_schema.sql"),
  "utf8",
);

test("percentage promotions are capped at 100%", () => {
  assert.match(sql, /discount_value <= 100/);
});

test("preview_promotion caps the discount at the subtotal", () => {
  assert.match(sql, /v_discount := least\(v_discount, v_base\);/);
});

test("preview_promotion checks the date window before returning valid", () => {
  assert.match(sql, /now\(\) < v_promo\.starts_at/);
  assert.match(sql, /now\(\) > v_promo\.ends_at/);
});

test("promotion_redemptions enforces one redemption per booking", () => {
  assert.match(sql, /constraint promotion_redemptions_booking_unique unique \(booking_id\)/);
});
