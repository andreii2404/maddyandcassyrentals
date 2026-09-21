import test from "node:test";
import assert from "node:assert/strict";
import { feedbackNextStep, friendlyMessage } from "../src/lib/friendlyMessage";

test("error references and ids are never shown to the user", () => {
  const message = friendlyMessage(
    "The payment review could not be saved. Error reference: 3f1c2a9e-8d4b-4e0a-9c1d-1b2c3d4e5f60",
    "error",
  );
  assert.equal(message, "We couldn't save the payment review. Please try again.");
  assert.doesNotMatch(message, /reference|3f1c2a9e/i);
});

test("plain 'could not be' sentences read as friendly first-person messages", () => {
  assert.equal(friendlyMessage("The booking status could not be updated.", "error"), "We couldn't update the booking status. Please try again.");
  assert.equal(friendlyMessage("This document could not be opened.", "error"), "We couldn't open this document. Please try again.");
  assert.equal(friendlyMessage("The product image could not be uploaded.", "error"), "We couldn't upload the product image. Please try again.");
});

test("messages that already tell the user what to do are left alone", () => {
  const message = "We couldn't update your profile. Please try again.";
  assert.equal(friendlyMessage(message, "error"), message);
  assert.equal(friendlyMessage("Enter a valid Facebook profile link.", "warning"), "Enter a valid Facebook profile link.");
});

test("success and info messages are not rewritten into errors", () => {
  assert.equal(friendlyMessage("Photo added.", "success"), "Photo added.");
  assert.equal(friendlyMessage("Booking updated.", "info"), "Booking updated.");
});

test("raw database, code and developer messages are replaced with plain wording", () => {
  const generic = "Something went wrong on our end. Please try again in a moment.";
  const technical = [
    'duplicate key value violates unique constraint "bookings_pkey"',
    'new row violates row-level security policy for table "bookings"',
    "PGRST116: JSON object requested, multiple (or no) rows returned",
    "PAYMENT_ALREADY_REVIEWED",
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "Unexpected token < in JSON at position 0",
    "Request failed with status code 500",
    'relation "public.booking_payment_submissions" does not exist',
    "Could not find the 'amount' column of 'x' in the schema cache",
    "Missing SUPABASE_SECRET_KEY environment variable",
    "Add the booking email settings in Vercel to send customer emails.",
  ];
  for (const raw of technical) {
    assert.equal(friendlyMessage(raw, "error"), generic, raw);
  }
});

test("connection failures get a connection-specific message", () => {
  const expected = "We couldn't reach the server. Please check your internet connection and try again.";
  assert.equal(friendlyMessage("Failed to fetch", "error"), expected);
  assert.equal(friendlyMessage("NetworkError when attempting to fetch resource.", "error"), expected);
  assert.equal(friendlyMessage("Load failed", "error"), expected);
});

test("empty messages fall back to a friendly default", () => {
  assert.equal(friendlyMessage("   ", "error"), "Something went wrong on our end. Please try again in a moment.");
});

test("next-step guidance is added only when the message does not already give any", () => {
  assert.equal(feedbackNextStep("error", "We couldn't save the review. Please try again."), null);
  assert.match(feedbackNextStep("error", "We couldn't save the review.") ?? "", /try again/i);
  assert.match(feedbackNextStep("success", "Photo added.") ?? "", /keep going|continue/i);
  assert.match(feedbackNextStep("warning", "Product name is required.") ?? "", /check/i);
});
