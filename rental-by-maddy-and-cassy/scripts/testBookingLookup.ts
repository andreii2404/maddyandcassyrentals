import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrackingTimeline,
  isValidBookingReference,
  normalizeBookingReference,
  publicStatusLabel,
  type TrackingTimelineInput,
} from "../src/lib/bookingLookup";
import { renderCopyableReference } from "../src/lib/emailShell";

const CREATED = "2026-10-01T01:00:00.000Z";
const LATER = "2026-10-02T01:00:00.000Z";

function timeline(overrides: Partial<TrackingTimelineInput>) {
  return buildTrackingTimeline({
    status: "pending",
    fulfillmentMethod: "pickup",
    paymentState: "none",
    createdAt: CREATED,
    approvedAt: null,
    confirmedAt: null,
    readyForReleaseAt: null,
    releasedAt: null,
    returnedAt: null,
    cancelledAt: null,
    rejectedAt: null,
    ...overrides,
  });
}

test("booking references are normalized and validated before searching", () => {
  assert.equal(normalizeBookingReference("  bk-cfc07994ec "), "BK-CFC07994EC");
  assert.equal(normalizeBookingReference("BK-CFC 0799 4EC"), "BK-CFC07994EC");
  assert.equal(isValidBookingReference("BK-CFC07994EC"), true);
  assert.equal(isValidBookingReference("bk-cfc07994ec"), true);
  assert.equal(isValidBookingReference("BK-12345"), false);
  assert.equal(isValidBookingReference("CFC07994EC"), false);
  assert.equal(isValidBookingReference("BK-CFC07994EC%"), false);
  assert.equal(isValidBookingReference("BK-CFC_7994EC"), false);
});

test("a new booking shows payment verification as the step in progress", () => {
  const steps = timeline({ paymentState: "in_review" });
  assert.deepEqual(
    steps.map((step) => [step.key, step.state]),
    [
      ["received", "complete"],
      ["payment", "current"],
      ["confirmed", "upcoming"],
      ["ready", "upcoming"],
      ["released", "upcoming"],
      ["returned", "upcoming"],
    ],
  );
  assert.equal(steps[0].timestamp, CREATED);
  assert.match(steps[1].description, /being verified/);
  assert.ok(steps.slice(2).every((step) => step.timestamp === null));
});

test("a verified payment moves the timeline on to confirmation", () => {
  const steps = timeline({ status: "approved", paymentState: "verified", approvedAt: LATER });
  assert.equal(steps.find((step) => step.key === "payment")?.state, "complete");
  const confirmed = steps.find((step) => step.key === "confirmed");
  assert.equal(confirmed?.state, "current");
  assert.equal(confirmed?.timestamp, LATER);
});

test("confirmed bookings count payment as verified and wait for release", () => {
  const steps = timeline({ status: "confirmed", confirmedAt: LATER });
  assert.deepEqual(
    steps.map((step) => step.state),
    ["complete", "complete", "complete", "current", "upcoming", "upcoming"],
  );
});

test("returned bookings complete every milestone", () => {
  const steps = timeline({
    status: "returned",
    confirmedAt: LATER,
    readyForReleaseAt: LATER,
    releasedAt: LATER,
    returnedAt: LATER,
  });
  assert.ok(steps.every((step) => step.state === "complete"));
});

test("cancelled bookings list only reached milestones, then the closing event", () => {
  const steps = timeline({ status: "cancelled", approvedAt: LATER, cancelledAt: LATER });
  assert.deepEqual(
    steps.map((step) => [step.key, step.state]),
    [
      ["received", "complete"],
      ["closed", "closed"],
    ],
  );
  assert.equal(steps.at(-1)?.label, "Cancelled");
  assert.equal(steps.at(-1)?.timestamp, LATER);
});

test("rejected bookings close with a Rejected event", () => {
  const steps = timeline({ status: "rejected", paymentState: "verified", rejectedAt: LATER });
  assert.deepEqual(steps.map((step) => step.key), ["received", "payment", "closed"]);
  assert.equal(steps.at(-1)?.label, "Rejected");
});

test("status labels follow the fulfillment method", () => {
  assert.equal(publicStatusLabel("ready_for_release", "pickup"), "Ready for Pickup");
  assert.equal(publicStatusLabel("ready_for_release", "delivery"), "Ready for Delivery");
  assert.equal(publicStatusLabel("pending", "pickup"), "Booking Received");
});

test("copyable references stay escaped and selectable as a whole", () => {
  const html = renderCopyableReference("BK-&lt;X&gt;");
  assert.match(html, /user-select:all/);
  assert.match(html, />BK-&lt;X&gt;</);
});
