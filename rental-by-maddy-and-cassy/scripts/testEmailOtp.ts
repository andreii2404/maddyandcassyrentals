import test from "node:test";
import assert from "node:assert/strict";
import {
  OTP_EXPIRY_MS,
  OTP_RESEND_COOLDOWN_SECONDS,
  clearOtpSent,
  isOtpExpired,
  readOtpSentAt,
  recordOtpSent,
  resendCooldownRemaining,
  type OtpStorage,
} from "../src/lib/emailOtp";

function memoryStorage(): OtpStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

test("codes expire at exactly ten minutes", () => {
  assert.equal(OTP_EXPIRY_MS, 600_000);
  const sentAt = 1_000_000;
  assert.equal(isOtpExpired(sentAt, sentAt + OTP_EXPIRY_MS - 1), false);
  assert.equal(isOtpExpired(sentAt, sentAt + OTP_EXPIRY_MS), true);
});

test("only the most recent send time is kept for an email", () => {
  const storage = memoryStorage();
  recordOtpSent("Customer@Example.com", 1_000, storage);
  recordOtpSent(" customer@example.com ", 5_000, storage);
  assert.equal(readOtpSentAt("customer@example.com", storage), 5_000);
  assert.equal(storage.data.size, 1);
});

test("send times are isolated per email and can be cleared", () => {
  const storage = memoryStorage();
  recordOtpSent("a@example.com", 1_000, storage);
  recordOtpSent("b@example.com", 2_000, storage);
  clearOtpSent("a@example.com", storage);
  assert.equal(readOtpSentAt("a@example.com", storage), null);
  assert.equal(readOtpSentAt("b@example.com", storage), 2_000);
});

test("missing, corrupt or unavailable storage reads as no record", () => {
  const storage = memoryStorage();
  assert.equal(readOtpSentAt("a@example.com", storage), null);
  storage.setItem("emailOtp:sentAt:a@example.com", "not-a-number");
  assert.equal(readOtpSentAt("a@example.com", storage), null);
  assert.equal(readOtpSentAt("a@example.com", null), null);
  assert.doesNotThrow(() => recordOtpSent("a@example.com", 1, null));
  const throwing: OtpStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readOtpSentAt("a@example.com", throwing), null);
  assert.doesNotThrow(() => recordOtpSent("a@example.com", 1, throwing));
  assert.doesNotThrow(() => clearOtpSent("a@example.com", throwing));
});

test("resend cooldown counts down from the latest send and never goes negative", () => {
  const sentAt = 10_000;
  assert.equal(resendCooldownRemaining(sentAt, sentAt), OTP_RESEND_COOLDOWN_SECONDS);
  assert.equal(resendCooldownRemaining(sentAt, sentAt + 15_500), 45);
  assert.equal(resendCooldownRemaining(sentAt, sentAt + 60_000), 0);
  assert.equal(resendCooldownRemaining(sentAt, sentAt + 999_000), 0);
  assert.equal(resendCooldownRemaining(sentAt, sentAt - 5_000), OTP_RESEND_COOLDOWN_SECONDS);
});
