import test from "node:test";
import assert from "node:assert/strict";
import {
  canCustomerCancelBooking,
  canCustomerEditBooking,
  getBookingHistoryGroup,
  getBookingMilestones,
  getFulfillmentProgressLabel,
} from "../src/lib/bookingManagement";
import type { Booking } from "../src/types/booking";
import { createEmptyDraft } from "../src/types/reservationDraft";
import {
  RESERVATION_PROGRESS_TTL_MS,
  restoreReservationProgress,
  serializeReservationProgress,
} from "../src/lib/reservationProgress";
import { isDuplicateReviewError } from "../src/lib/reviewSubmission";

function booking(status: Booking["status"], method: Booking["fulfillmentMethod"] = "pickup"): Booking {
  return {
    id: "booking-id",
    bookingRef: "BK-TEST",
    customerId: "customer-id",
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
    productSnapshot: { name: "Test Phone", brand: "Apple", category: "iPhones", image: "/test.png", pricePerDay: 1000, currency: "PHP", included: [] },
    customerSnapshot: { fullName: "Test Customer", email: "test@example.com", phone: "", address: "", facebookLink: "", instagramLink: "" },
    requirementsStatus: "not_submitted",
    agreementStatus: "not_created",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

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
