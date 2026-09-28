import assert from "node:assert/strict";
import test from "node:test";
import { phaseCompletionLabel, reservationPhaseForStep } from "../src/lib/reservationPhases";

test("maps the existing six steps into the three customer phases", () => {
  assert.equal(reservationPhaseForStep(1), 1);
  assert.equal(reservationPhaseForStep(3), 1);
  assert.equal(reservationPhaseForStep(4), 2);
  assert.equal(reservationPhaseForStep(5), 3);
  assert.equal(reservationPhaseForStep(6), 3);
});

test("describes phase progress without changing booking status", () => {
  assert.equal(phaseCompletionLabel(1, 4), "Complete");
  assert.equal(phaseCompletionLabel(2, 4), "In progress");
  assert.equal(phaseCompletionLabel(3, 4), "Up next");
});
