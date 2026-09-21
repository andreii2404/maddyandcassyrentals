import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETED_RENTALS_BEFORE_REWARD,
  LOYALTY_REWARD_DISCOUNT,
} from "../src/lib/promotions";
import { describeLoyaltyOutcome, getLoyaltyEmailOutcome } from "../src/lib/loyaltyOutcome";
import { buildRentalCompletedEmail } from "../src/lib/rentalCompletedEmailContent";
import { buildCustomerUpdateEmail } from "../src/lib/customerUpdateEmailContent";

const account = { isGuest: false, loyaltyRewardUsed: false, thisBookingRewardAmount: 0 };

test("guests never get a loyalty outcome", () => {
  assert.deepEqual(
    getLoyaltyEmailOutcome({ ...account, isGuest: true, completedRentals: 4 }),
    { kind: "none" },
  );
});

test("progress shows how many rentals remain, using the shared constants", () => {
  const outcome = getLoyaltyEmailOutcome({ ...account, completedRentals: 3 });
  assert.deepEqual(outcome, {
    kind: "progress",
    completedRentals: 3,
    rentalsUntilReward: COMPLETED_RENTALS_BEFORE_REWARD - 3,
  });
  const text = describeLoyaltyOutcome(outcome) ?? "";
  assert.match(text, new RegExp(`3 of ${COMPLETED_RENTALS_BEFORE_REWARD}`));
  assert.match(text, new RegExp(String(LOYALTY_REWARD_DISCOUNT)));
});

test("reaching the threshold unlocks the reward exactly once", () => {
  assert.deepEqual(
    getLoyaltyEmailOutcome({ ...account, completedRentals: COMPLETED_RENTALS_BEFORE_REWARD }),
    { kind: "reward_unlocked" },
  );
  assert.deepEqual(
    getLoyaltyEmailOutcome({ ...account, completedRentals: COMPLETED_RENTALS_BEFORE_REWARD + 2 }),
    { kind: "reward_available" },
  );
});

test("a used reward shows only when this rental used it", () => {
  assert.deepEqual(
    getLoyaltyEmailOutcome({
      ...account,
      completedRentals: COMPLETED_RENTALS_BEFORE_REWARD + 1,
      loyaltyRewardUsed: true,
      thisBookingRewardAmount: LOYALTY_REWARD_DISCOUNT,
    }),
    { kind: "reward_applied", discountAmount: LOYALTY_REWARD_DISCOUNT },
  );
  assert.deepEqual(
    getLoyaltyEmailOutcome({
      ...account,
      completedRentals: COMPLETED_RENTALS_BEFORE_REWARD + 5,
      loyaltyRewardUsed: true,
    }),
    { kind: "none" },
  );
  assert.equal(describeLoyaltyOutcome({ kind: "none" }), null);
});

const completed = {
  bookingId: "booking-1",
  bookingReference: "BK-100",
  customerName: "Ana Cruz",
  customerEmail: "ana@example.com",
  items: [{ name: "Canon R50", quantity: 1 }, { name: "Tripod", quantity: 2 }],
  completedAt: "2026-09-25T04:00:00.000Z",
  bookingUrl: "https://example.com/account/bookings/booking-1",
  isGuest: false,
  rentalTotal: 2500,
  charges: [{ label: "Late Fee", amount: 500 }],
  totalPaid: 3000,
  balance: 0,
  loyalty: { kind: "progress" as const, completedRentals: 4, rentalsUntilReward: 6 },
};

test("the completed email lists every required detail", () => {
  const email = buildRentalCompletedEmail(completed);
  for (const part of ["Ana", "BK-100", "Canon R50", "Tripod", "Sep 25, 2026", "Late Fee", "₱500", "₱3,000", "Thank you"]) {
    assert.ok(email.html.includes(part), `html is missing ${part}`);
    assert.ok(email.text.includes(part), `text is missing ${part}`);
  }
  assert.match(email.subject, /BK-100/);
  assert.match(email.html, /4 of/);
});

test("the completed email leaves out loyalty when there is nothing to report", () => {
  const email = buildRentalCompletedEmail({ ...completed, loyalty: { kind: "none" }, charges: [] });
  assert.ok(!/loyalty/i.test(email.html));
  assert.ok(!/loyalty/i.test(email.text));
});

test("the completed email escapes customer-controlled text", () => {
  const email = buildRentalCompletedEmail({ ...completed, customerName: "<b>Ana</b>", items: [{ name: "<i>Cam</i>", quantity: 1 }] });
  assert.ok(!email.html.includes("<b>Ana</b>"));
  assert.ok(!email.html.includes("<i>Cam</i>"));
});

test("a customer update keeps the admin's subject and escapes the message", () => {
  const email = buildCustomerUpdateEmail({
    bookingReference: "BK-100",
    customerName: "Ana Cruz",
    subject: "Damage notice",
    message: "We noticed damage.\n\n<script>alert(1)</script>",
    bookingUrl: "https://example.com/b",
    isGuest: false,
  });
  assert.equal(email.subject, "Damage notice");
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("We noticed damage."));
  assert.ok(email.text.includes("We noticed damage."));
});

test("a customer update can show the related charge", () => {
  const email = buildCustomerUpdateEmail({
    bookingReference: "BK-100",
    customerName: "Ana Cruz",
    subject: "Late fee",
    message: "Please prepare the late fee.",
    bookingUrl: "https://example.com/b",
    isGuest: false,
    charge: { label: "Late Fee", amount: 500, paid: false },
  });
  assert.ok(email.html.includes("Late Fee"));
  assert.ok(email.html.includes("₱500"));
  assert.ok(email.html.includes("Unpaid"));
  assert.ok(email.text.includes("Late Fee: ₱500 (Unpaid)"));
});
