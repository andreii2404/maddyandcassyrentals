import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260930141305_backfill_email_notification_event_keys.sql", import.meta.url),
  "utf8",
);

test("email notification inserts backfill a booking event key at the database boundary", () => {
  assert.match(migration, /create or replace function private\.set_email_notification_event_key\(\)/i);
  assert.match(migration, /new\.email_type\s*=\s*'booking_pending'/i);
  assert.match(migration, /booking-pending-/i);
  assert.match(migration, /payment-verified-' \|\| coalesce\(new\.id::text/i);
  assert.match(migration, /before insert on public\.email_notifications/i);
  assert.match(migration, /if new\.event_key is null or btrim\(new\.event_key\) = ''/i);
});
