import test from "node:test";
import assert from "node:assert/strict";
import {
  canCustomerCancelBooking,
  canCustomerEditBooking,
  getApprovalBlockers,
  getBookingHistoryGroup,
  getBookingMilestones,
  getFulfillmentProgressLabel,
  getPendingStageLabel,
} from "../src/lib/bookingManagement";
import { CANCELLATION_REASON_OPTIONS, type Booking } from "../src/types/booking";
import { createEmptyDraft } from "../src/types/reservationDraft";
import {
  RESERVATION_PROGRESS_TTL_MS,
  restoreReservationProgress,
  serializeReservationProgress,
} from "../src/lib/reservationProgress";
import { isDuplicateReviewError } from "../src/lib/reviewSubmission";
import { buildBookingStatusEmail } from "../src/lib/bookingStatusEmailContent";
import { bookingTrackingPath } from "../src/lib/bookingAccess";
import { buildApprovalEmailDetails } from "../src/lib/bookingApprovalEmailDetails";

function booking(status: Booking["status"], method: Booking["fulfillmentMethod"] = "pickup"): Booking {
  return {
    id: "booking-id",
    bookingRef: "BK-TEST",
    customerId: "customer-id",
    isGuestCheckout: false,
    items: [
      {
        bookingItemId: "booking-item-id",
        productId: "product-id",
        productName: "Test Phone",
        brand: "Apple",
        category: "iPhones",
        image: "/test.png",
        quantity: 1,
        dailyRate: 1000,
        refundableDeposit: 500,
        included: [],
        lineRentalSubtotal: 2000,
        assignedUnitCount: 1,
      },
    ],
    productId: "product-id",
    inventoryUnitId: "unit-id",
    quantity: 1,
    status,
    fulfillmentMethod: method,
    startDate: "2026-08-10",
    endDate: "2026-08-11",
    dayCount: 2,
    dailyRate: 1000,
    refundableDeposit: 500,
    rentalSubtotal: 2000,
    specialDiscountAmount: 0,
    birthdayDiscountAmount: 0,
    birthdayDiscountStatus: "not_eligible",
    loyaltyCompletedRentalsSnapshot: 0,
    loyaltyDiscountAmount: 0,
    loyaltyDiscountStatus: "not_eligible",
    deliveryFee: 0,
    totalAmount: 2500,
    balancePaymentPreference: "online_gcash",
    payLaterAllowed: false,
    productSnapshot: { name: "Test Phone", brand: "Apple", category: "iPhones", image: "/test.png", pricePerDay: 1000, currency: "PHP", included: [] },
    customerSnapshot: { fullName: "Test Customer", email: "test@example.com", phone: "", address: "", facebookLink: "", instagramLink: "" },
    requirementsStatus: "not_submitted",
    agreementStatus: "not_created",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

test("guest booking links stay outside account-only route guards", () => {
  assert.equal(bookingTrackingPath("booking/id", true), "/guest/bookings/booking%2Fid");
  assert.equal(bookingTrackingPath("booking-id", false, "#booking-documents"), "/account/bookings/booking-id#booking-documents");
});

test("booking history groups ongoing, completed, and cancelled states", () => {
  assert.equal(getBookingHistoryGroup("pending"), "ongoing");
  assert.equal(getBookingHistoryGroup("ready_for_release"), "ongoing");
  assert.equal(getBookingHistoryGroup("returned"), "completed");
  assert.equal(getBookingHistoryGroup("cancelled"), "cancelled");
  assert.equal(getBookingHistoryGroup("rejected"), "cancelled");
});

test("customer actions are limited to safe booking states", () => {
  assert.equal(canCustomerCancelBooking("pending"), true);
  assert.equal(canCustomerCancelBooking("approved"), true);
  assert.equal(canCustomerCancelBooking("confirmed"), false);
  assert.equal(canCustomerEditBooking(booking("pending"), false), true);
  assert.equal(canCustomerEditBooking(booking("pending"), true), false);
  assert.equal(canCustomerEditBooking(booking("approved"), false), false);
});

test("customer cancellation reasons use the structured options", () => {
  assert.deepEqual(CANCELLATION_REASON_OPTIONS, [
    "Change of plans",
    "Wrong booking details",
    "Schedule conflict",
    "Budget issue",
    "Found another option",
    "Other",
  ]);
});

test("pickup and delivery milestones expose handover and completion progress", () => {
  const ready = booking("ready_for_release", "delivery");
  ready.approvedAt = "2026-08-09T01:00:00.000Z";
  ready.confirmedAt = "2026-08-09T02:00:00.000Z";
  ready.readyForReleaseAt = "2026-08-10T01:00:00.000Z";
  const milestones = getBookingMilestones(ready);
  assert.equal(getFulfillmentProgressLabel(ready.status, ready.fulfillmentMethod), "Ready for delivery");
  assert.equal(milestones.find((item) => item.key === "ready")?.current, true);
  assert.equal(milestones.find((item) => item.key === "completed")?.completed, false);

  const returned = booking("returned");
  returned.returnedAt = "2026-08-12T01:00:00.000Z";
  assert.equal(getFulfillmentProgressLabel(returned.status, returned.fulfillmentMethod), "Completed");
  assert.equal(getBookingMilestones(returned).at(-1)?.completed, true);
});

test("reservation progress restores form values without retaining private files", () => {
  const draft = createEmptyDraft();
  draft.startDate = new Date("2026-08-20T00:00:00.000Z");
  draft.endDate = new Date("2026-08-21T00:00:00.000Z");
  draft.customerInfo.fullName = "Andrei Test";
  draft.requirements.emergencyContact.fullName = "Emergency Contact";
  draft.requirements.idOneFile = { name: "private-id.png" } as File;
  draft.agreement.signatureDataUrl = "data:image/png;base64,private-signature";

  const savedAt = Date.now();
  const restored = restoreReservationProgress(serializeReservationProgress({
    draft,
    step: 4,
    bookingId: "booking-id",
    bookingNumber: "BK-TEST",
    paymentState: "paid",
    isDemoPayment: false,
    savedAt,
  }), savedAt + 1000);

  assert.equal(restored?.step, 4);
  assert.equal(restored?.draft.customerInfo.fullName, "Andrei Test");
  assert.equal(restored?.draft.startDate?.toISOString(), "2026-08-20T00:00:00.000Z");
  assert.equal(restored?.draft.requirements.idOneFile, null);
  assert.equal(restored?.draft.agreement.signatureDataUrl, null);
  assert.equal(
    restoreReservationProgress(
      serializeReservationProgress({
        draft,
        step: 2,
        bookingId: null,
        bookingNumber: null,
        paymentState: "unpaid",
        isDemoPayment: false,
        savedAt,
      }),
      savedAt + RESERVATION_PROGRESS_TTL_MS + 1,
    ),
    null,
  );
});

test("repeat review submissions are recognized without exposing a database constraint", () => {
  assert.equal(isDuplicateReviewError({ code: "23505", message: "duplicate key value" }), true);
  assert.equal(isDuplicateReviewError({ message: 'violates unique constraint "reviews_booking_item_id_key"' }), true);
  assert.equal(isDuplicateReviewError({ code: "42501", message: "permission denied" }), false);
});

test("getApprovalBlockers lists unmet approval requirements in order", () => {
  assert.deepEqual(
    getApprovalBlockers({
      requirementsStatus: "not_submitted",
      hasVerifiedPayment: false,
      agreementStatus: "not_created",
    }),
    [
      "Verify at least one payment.",
      "Approve every required verification document.",
      "Countersign the rental agreement.",
    ],
  );
  assert.deepEqual(
    getApprovalBlockers({
      requirementsStatus: "approved",
      hasVerifiedPayment: false,
      agreementStatus: "not_created",
    }),
    ["Verify at least one payment.", "Countersign the rental agreement."],
  );
  assert.deepEqual(
    getApprovalBlockers({
      requirementsStatus: "approved",
      hasVerifiedPayment: true,
      agreementStatus: "completed",
    }),
    [],
  );
});

test("getPendingStageLabel reflects where a pending booking is in the intake flow", () => {
  assert.equal(
    getPendingStageLabel({ status: "approved", requirementsStatus: "not_submitted", paymentProofSubmitted: false }),
    null,
  );
  assert.equal(
    getPendingStageLabel({ status: "pending", requirementsStatus: "not_submitted", paymentProofSubmitted: false }),
    "Awaiting Payment",
  );
  assert.equal(
    getPendingStageLabel({ status: "pending", requirementsStatus: "not_submitted", paymentProofSubmitted: true }),
    "Pending Requirements",
  );
  assert.equal(
    getPendingStageLabel({ status: "pending", requirementsStatus: "pending_review", paymentProofSubmitted: true }),
    "Under Review",
  );
});

test("approval and completion emails contain the booking reference and safe customer action", () => {
  const approved = buildBookingStatusEmail({
    bookingId: "booking-id",
    bookingReference: "BK-TEST-100",
    customerName: "Andrei <Test>",
    customerEmail: "andrei@example.com",
    productName: "iPhone 17 Pro Max",
    status: "approved",
    statusChangedAt: "2026-08-11T00:00:00.000Z",
    bookingUrl: "https://rentals.example.com/account/bookings/booking-id",
  });
  assert.match(approved.subject, /approved/i);
  assert.match(approved.text, /BK-TEST-100/);
  assert.match(approved.html, /Andrei/);
  assert.doesNotMatch(approved.html, /Andrei <Test>/);
  const detailedApproved = buildBookingStatusEmail({
    bookingId: "booking-id",
    bookingReference: "BK-TEST-100",
    customerName: "Andrei Test",
    customerEmail: "andrei@example.com",
    productName: "iPhone 17 Pro Max",
    status: "approved",
    statusChangedAt: "2026-09-10T08:00:00.000Z",
    bookingUrl: "https://example.com/account/bookings/booking-id",
    rentalDates: "Sep 12, 2026 - Sep 14, 2026 (2 days)",
    paymentStatus: "Partially Paid",
    amountPaid: "PHP 1,000",
    remainingBalance: "PHP 1,000",
    fulfillmentMethod: "Delivery",
    remainingAction: "Pay the remaining balance before handover",
  });
  assert.match(detailedApproved.text, /Rental dates: Sep 12, 2026 - Sep 14, 2026/);
  assert.match(detailedApproved.text, /Payment status: Partially Paid/);
  assert.match(detailedApproved.html, /PAYMENT STATUS/);
  assert.match(detailedApproved.html, /Pay the remaining balance before handover/);

  const completed = buildBookingStatusEmail({
    bookingId: "booking-id",
    bookingReference: "BK-TEST-100",
    customerName: "Andrei Test",
    customerEmail: "andrei@example.com",
    productName: "iPhone 17 Pro Max",
    status: "returned",
    statusChangedAt: "2026-08-12T00:00:00.000Z",
    bookingUrl: "https://rentals.example.com/account/bookings/booking-id",
  });
  assert.match(completed.subject, /completed/i);
  assert.match(completed.text, /leave a review/i);
});

test("approval confirmation email lists every booking detail the customer needs", () => {
  const approvedBooking: Booking = {
    ...booking("approved", "delivery"),
    startDate: "2026-09-12T01:00:00.000Z", // 9:00 AM Manila
    endDate: "2026-09-13T23:00:00.000Z", // 7:00 AM Manila
    dayCount: 2,
    totalAmount: 2500,
    location: "12 Rizal St",
    cityMunicipality: "Makati",
    approvedAt: "2026-09-10T08:00:00.000Z",
    customerSnapshot: { fullName: "Andrei <Test> Cruz", email: "guest@example.com", phone: "", address: "", facebookLink: "", instagramLink: "" },
  };
  const details = buildApprovalEmailDetails({
    booking: {
      ...approvedBooking,
      items: [
        ...approvedBooking.items,
        { ...approvedBooking.items[0], bookingItemId: "item-2", productName: "Tripod", quantity: 2 },
      ],
    },
    payments: [
      { declaredAmount: 1000, status: "verified" },
      { declaredAmount: 900, status: "rejected" },
    ],
    origin: "https://rentals.example.com",
    deliveryKey: "key",
  });

  assert.equal(details.customerEmail, "guest@example.com");
  assert.equal(details.paymentStatus, "Partially Paid");
  assert.equal(details.remainingBalance, "PHP 1,500");
  assert.equal(details.bookingStatus, "Approved");
  assert.match(details.pickupDateTime ?? "", /9:00/);
  assert.match(details.returnDateTime ?? "", /7:00/);
  assert.equal(details.pickupLocation, "12 Rizal St, Makati");

  const email = buildBookingStatusEmail(details);
  for (const expected of [
    "BK-TEST", "Test Phone × 1", "Tripod × 2", "Partially Paid", "Approved",
    "DELIVERY DATE &amp; TIME", "RETURN DATE &amp; TIME", "Important reminders",
    "Pay the remaining balance before handover", "Complete the rental agreement",
  ]) {
    assert.ok(email.html.includes(expected), `html should include ${expected}`);
  }
  assert.ok(email.html.includes("Andrei &lt;Test&gt; Cruz"));
  assert.ok(!email.html.includes("<Test>"));
  assert.match(email.text, /Customer: Andrei <Test> Cruz/);
  assert.match(email.text, /Rental item\(s\): Test Phone × 1, Tripod × 2/);
  assert.match(email.text, /Return date and time: /);
  assert.match(email.text, /Booking status: Approved/);
  assert.match(email.text, /- Pay the remaining balance before handover\./);
});

test("approval email targets guest bookings and never leaks technical wording", () => {
  const guest = buildApprovalEmailDetails({
    booking: {
      ...booking("approved"),
      isGuestCheckout: true,
      customerSnapshot: { fullName: "", email: "  ", phone: "", address: "", facebookLink: "", instagramLink: "" },
      requirementsStatus: "approved",
      agreementStatus: "completed",
      totalAmount: 1000,
    },
    payments: [{ declaredAmount: 1000, status: "verified" }],
    fallbackEmail: " account@example.com ",
    origin: "https://rentals.example.com",
    deliveryKey: "key",
  });

  assert.equal(guest.customerEmail, "account@example.com");
  assert.equal(guest.customerName, "Customer");
  assert.equal(guest.paymentStatus, "Paid");
  assert.equal(guest.remainingAction, undefined);
  assert.equal(guest.bookingUrl, "https://rentals.example.com/guest/bookings/booking-id");

  const email = buildBookingStatusEmail(guest);
  assert.match(email.html, /Guest checkout/);
  assert.doesNotMatch(`${email.subject}${email.html}${email.text}`, /RESEND|api key|not configured|undefined|NaN/i);
});
