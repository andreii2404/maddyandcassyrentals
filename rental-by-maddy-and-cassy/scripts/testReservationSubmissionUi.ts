import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldShowPaymentSubmission,
  shouldShowPaymentHandoff,
} from "../src/lib/reservationSubmissionUi";

test("payment submission is hidden after the reservation is successfully submitted", () => {
  assert.equal(shouldShowPaymentSubmission(3, true), false);
});

test("payment submission remains visible before the reservation is submitted", () => {
  assert.equal(shouldShowPaymentSubmission(3, false), true);
});

test("resume flow shows the submitted confirmation for an existing booking with submitted payment", () => {
  assert.equal(shouldShowPaymentHandoff("booking-1", "pending"), true);
  assert.equal(shouldShowPaymentHandoff("booking-1", "paid"), true);
});

test("new or unpaid bookings do not enter the submitted confirmation state", () => {
  assert.equal(shouldShowPaymentHandoff(null, "pending"), false);
  assert.equal(shouldShowPaymentHandoff("booking-1", "unpaid"), false);
});
