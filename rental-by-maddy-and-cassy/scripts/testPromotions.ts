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

test("redeem_promotion locks the booking row before checking eligibility", () => {
  const redeemSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929091000_redeem_promotion.sql"),
    "utf8",
  );
  assert.match(redeemSql, /where id = p_booking_id and customer_id = v_uid\s*\n\s*for update;/);
  assert.match(redeemSql, /select \* into v_promo from public\.promotions where upper\(code\) = v_code for update;/);
});

test("redeem_promotion rejects guest checkouts and re-redemption", () => {
  const redeemSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929091000_redeem_promotion.sql"),
    "utf8",
  );
  assert.match(redeemSql, /GUEST_NOT_ELIGIBLE/);
  assert.match(redeemSql, /PROMOTION_ALREADY_APPLIED/);
});

test("booking_totals subtracts the promotion discount from total_amount", () => {
  const redeemSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929091000_redeem_promotion.sql"),
    "utf8",
  );
  assert.match(redeemSql, /- b\.promotion_discount_amount,\s*\n\s*0::numeric/);
});

test("redeem_promotion blocks redemption on non-pending or already-paid bookings", () => {
  const redeemSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929091000_redeem_promotion.sql"),
    "utf8",
  );
  assert.match(redeemSql, /if v_booking\.status <> 'pending' or exists \(/);
  assert.match(
    redeemSql,
    /where bps\.booking_id = v_booking\.id\s*\n\s*and bps\.status in \('submitted', 'under_review', 'verified'\)/,
  );
  assert.match(redeemSql, /raise exception 'BOOKING_NOT_ELIGIBLE';/);
});

test("promotions.code has a case-insensitive unique index and zero-value redemptions are rejected", () => {
  const redeemSql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929091000_redeem_promotion.sql"),
    "utf8",
  );
  assert.match(redeemSql, /create unique index promotions_code_upper_unique on public\.promotions \(upper\(code\)\);/);
  assert.match(redeemSql, /if v_discount <= 0 then\s*\n\s*raise exception 'NO_DISCOUNT_APPLICABLE';/);
});
