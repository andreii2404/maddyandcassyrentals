import test from "node:test";
import assert from "node:assert/strict";
import {
  getPasswordValidationErrors,
  isAtLeastMinimumAge,
  isValidBirthDate,
  isStrongPassword,
  isValidPhoneNumber,
  normalizeEmail,
  normalizePhoneInput,
} from "../src/lib/authValidation";

test("email addresses are normalized consistently", () => {
  assert.equal(normalizeEmail("  Customer@Example.COM "), "customer@example.com");
});

test("phone fields retain only the required eleven digits", () => {
  assert.equal(normalizePhoneInput("0917 123-4567"), "09171234567");
  assert.equal(normalizePhoneInput("0917123456789"), "09171234567");
  assert.equal(isValidPhoneNumber("09171234567"), true);
  assert.equal(isValidPhoneNumber("0917123456"), false);
  assert.equal(isValidPhoneNumber("+639171234567"), false);
});

test("birthdates must be real, reasonable, and not in the future", () => {
  const today = new Date("2026-08-11T12:00:00+08:00");
  assert.equal(isValidBirthDate("2000-08-24", today), true);
  assert.equal(isValidBirthDate("2026-08-12", today), false);
  assert.equal(isValidBirthDate("2026-02-30", today), false);
  assert.equal(isValidBirthDate("1899-12-31", today), false);
  assert.equal(isValidBirthDate("", today), false);
});

test("registrants must be at least 18 years old", () => {
  const today = new Date("2026-08-11T12:00:00+08:00");
  assert.equal(isAtLeastMinimumAge("2008-08-11", today), true);
  assert.equal(isAtLeastMinimumAge("2000-08-24", today), true);
  assert.equal(isAtLeastMinimumAge("2008-08-12", today), false);
  assert.equal(isAtLeastMinimumAge("2010-01-01", today), false);
});

test("new passwords require a balanced minimum strength", () => {
  assert.equal(isStrongPassword("Rental2026"), true);
  assert.equal(isStrongPassword("password"), false);
  assert.deepEqual(getPasswordValidationErrors("short"), [
    "At least 8 characters",
    "One uppercase letter",
    "One number",
  ]);
});
