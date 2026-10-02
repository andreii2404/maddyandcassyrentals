import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  isUuid,
  mapFulfillmentRpcError,
  parseIsoDate,
} from "../src/lib/fulfillmentApiHelpers";

test("uuid check accepts real ids and rejects anything else", () => {
  assert.equal(isUuid("3f2b8c1e-9d4a-4c1b-8a5e-1b2c3d4e5f60"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(undefined), false);
});

test("dates must be real ISO-style values", () => {
  assert.equal(parseIsoDate("2026-09-21T02:30:00.000Z"), "2026-09-21T02:30:00.000Z");
  assert.equal(parseIsoDate("garbage"), null);
  assert.equal(parseIsoDate(42), null);
  assert.equal(parseIsoDate("1999-01-01T00:00:00.000Z"), null);
});

test("text is trimmed, capped and never non-string", () => {
  assert.equal(cleanText("  hello  ", 10), "hello");
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(cleanText(12, 10), "");
  assert.equal(cleanText(undefined, 10), "");
});

test("database error codes become friendly messages with the right status", () => {
  assert.deepEqual(mapFulfillmentRpcError("BALANCE_PAYMENT_REQUIRED"), {
    status: 409,
    message: "The remaining balance must be settled before pickup can be confirmed.",
  });
  assert.equal(mapFulfillmentRpcError("error: PICKUP_NOT_READY (P0001)")?.status, 409);
  assert.equal(mapFulfillmentRpcError("NOT_AUTHORIZED")?.status, 403);
  assert.equal(mapFulfillmentRpcError("CHARGE_NOT_FOUND")?.status, 404);
  assert.equal(mapFulfillmentRpcError("DAMAGE_NOTES_REQUIRED")?.status, 400);
  assert.equal(mapFulfillmentRpcError("something unexpected"), null);
});

test("security deposit database codes map to the right status", () => {
  assert.equal(mapFulfillmentRpcError("error: SECURITY_DEPOSIT_REQUIRED (P0001)")?.status, 409);
  assert.match(mapFulfillmentRpcError("SECURITY_DEPOSIT_REQUIRED")?.message ?? "", /security deposit/);
  assert.equal(mapFulfillmentRpcError("DEPOSIT_NOT_READY")?.status, 409);
  assert.equal(mapFulfillmentRpcError("DEPOSIT_ALREADY_RECORDED")?.status, 409);
  assert.equal(mapFulfillmentRpcError("INVALID_DEPOSIT_METHOD")?.status, 400);
  assert.match(mapFulfillmentRpcError("INVALID_DEPOSIT_METHOD")?.message ?? "", /Maya/);
  assert.equal(mapFulfillmentRpcError("REFERENCE_REQUIRED")?.status, 400);
  assert.equal(mapFulfillmentRpcError("INVALID_REFERENCE")?.status, 400);
  // A plain REASON_REQUIRED must still resolve to the charge-reason message.
  assert.match(mapFulfillmentRpcError("REASON_REQUIRED")?.message ?? "", /reason/i);
});

test("no friendly message leaks a raw error code", () => {
  for (const code of [
    "COMPLETION_BLOCKED",
    "INVALID_DATE",
    "RENTAL_COMPLETED",
    "REASON_REQUIRED",
    "SECURITY_DEPOSIT_REQUIRED",
    "DEPOSIT_NOT_READY",
    "DEPOSIT_ALREADY_RECORDED",
    "INVALID_DEPOSIT_METHOD",
    "REFERENCE_REQUIRED",
    "INVALID_REFERENCE",
  ]) {
    const mapped = mapFulfillmentRpcError(code);
    assert.ok(mapped, `${code} should be mapped`);
    assert.ok(!/[A-Z]{4,}_[A-Z_]+/.test(mapped.message));
  }
});
