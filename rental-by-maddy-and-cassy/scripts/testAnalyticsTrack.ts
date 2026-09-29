import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929093000_analytics_events.sql"),
  "utf8",
);

test("log_marketing_event rejects an event_type outside the allow-list", () => {
  assert.match(sql, /if p_event_type not in \(/);
  assert.match(sql, /raise exception 'INVALID_EVENT_TYPE';/);
});

test("analytics_events has no direct anon/authenticated write access (insert-only via RPC)", () => {
  assert.match(sql, /revoke all on table public\.analytics_events from anon, authenticated;/);
  assert.match(sql, /grant select on table public\.analytics_events to authenticated;/);
});

test("customer identity comes from auth.uid(), never a client-supplied parameter", () => {
  assert.doesNotMatch(sql, /p_customer_id/);
  assert.match(sql, /v_uid := auth\.uid\(\);/);
});

test("the same seven event types are allowed in both the table check constraint and the RPC guard", () => {
  const eventList = "'product_view', 'search', 'add_to_cart', 'checkout_start',\n    'booking_completed', 'promotion_applied', 'newsletter_signup'";
  const occurrences = sql.split(eventList).length - 1;
  assert.equal(occurrences, 2);
});
