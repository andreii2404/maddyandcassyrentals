import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/20260929092000_newsletter_subscribers.sql"),
  "utf8",
);

test("subscribe_newsletter validates email format before inserting", () => {
  assert.match(sql, /INVALID_EMAIL/);
  assert.match(sql, /\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$/);
});

test("subscribe_newsletter upserts on the unique email constraint instead of erroring on duplicates", () => {
  assert.match(sql, /on conflict \(email\) do update set/);
});

test("newsletter_subscribers has no direct anon/authenticated write access", () => {
  assert.match(sql, /revoke all on table public\.newsletter_subscribers from anon, authenticated;/);
});

test("unsubscribe_newsletter only flips subscribed rows and reports whether it changed anything", () => {
  assert.match(sql, /where unsubscribe_token = p_token and status = 'subscribed';/);
  assert.match(sql, /return v_rows > 0;/);
});
