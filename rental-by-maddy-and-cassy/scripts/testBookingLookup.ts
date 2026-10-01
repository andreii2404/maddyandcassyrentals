import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidBookingReference,
  normalizeBookingReference,
  normalizeLookupCode,
} from "../src/lib/bookingLookup";
import { buildBookingLookupCodeEmail } from "../src/lib/bookingLookupEmail";
import { renderCopyableReference } from "../src/lib/emailShell";

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

test("verification codes keep only six digits", () => {
  assert.equal(normalizeLookupCode("12 34-56789"), "123456");
  assert.equal(normalizeLookupCode("abc"), "");
});

test("verification email carries the code but no booking link or details", () => {
  const email = buildBookingLookupCodeEmail({
    bookingReference: "BK-CFC07994EC",
    code: "042917",
    expiresInMinutes: 10,
  });
  assert.match(email.subject, /BK-CFC07994EC/);
  assert.match(email.text, /042917/);
  assert.match(email.html, />042917</);
  assert.match(email.html, />BK-CFC07994EC</);
  assert.match(email.text, /expires in 10 minutes/);
  assert.doesNotMatch(email.html, /href=/);
});

test("copyable references stay escaped and selectable as a whole", () => {
  const html = renderCopyableReference("BK-&lt;X&gt;");
  assert.match(html, /user-select:all/);
  assert.match(html, />BK-&lt;X&gt;</);
});
