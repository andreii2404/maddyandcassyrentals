"use client";

import type { Product } from "@/types/product";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import { calculateReservationPricing } from "@/src/lib/reservationPricing";
import {
  COMPLETED_RENTALS_BEFORE_REWARD,
  type RewardProgress,
} from "@/src/lib/promotions";
import formStyles from "@/components/ui/Form.module.css";
import sharedStyles from "./StepShared.module.css";
import styles from "./StepPaymentSubmission.module.css";

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Derived client-side from summing payment_records for this booking — see ReserveFlowClient. */
export type BookingPaymentState = "unpaid" | "pending" | "partially_paid" | "paid";

interface StepPaymentSubmissionProps {
  product: Product;
  draft: ReservationDraft;
  rewardProgress: RewardProgress;
  paymentState: BookingPaymentState;
  isDemoPayment?: boolean;
  bookingNumber?: string;
  opening: boolean;
  checking: boolean;
  error: string | null;
  onPaymentOptionChange: (option: "deposit_50" | "full") => void;
  onBack: () => void;
  onPay: () => void;
  onContinue: () => void;
}

export default function StepPaymentSubmission({
  product,
  draft,
  rewardProgress,
  paymentState,
  isDemoPayment = false,
  bookingNumber,
  opening,
  checking,
  error,
  onPaymentOptionChange,
  onBack,
  onPay,
  onContinue,
}: StepPaymentSubmissionProps) {
  const pricing = calculateReservationPricing(product, draft, rewardProgress);
  const dueNow = draft.paymentOption === "deposit_50"
    ? Math.round(pricing.finalAmount * 50) / 100
    : pricing.finalAmount;
  const paid = paymentState === "paid" || paymentState === "partially_paid";

  return (
    <div className={sharedStyles.wrapper}>
      <h2 className={sharedStyles.heading}>Payment Submission</h2>
      <p className={sharedStyles.subheading}>
        Choose how much to pay now, then continue to PayMongo&apos;s secure checkout.
      </p>

      <div className={styles.guarantee}>
        <strong>Your selected rental dates are secured once PayMongo verifies your payment.</strong>
        <span>
          Paying 50% guarantees the reservation while leaving the remaining balance visible in
          your account. The reservation payment and listed deposit are non-refundable. Paying in
          full settles the online booking amount immediately.
        </span>
      </div>

      <div className={styles.perks}>
        <div>
          <span className={styles.perkIcon} aria-hidden="true">BDAY</span>
          <p>
            <strong>Birthday month: ₱100 off</strong>
            <small>
              {pricing.birthdayDiscountAmount > 0
                ? "Applied to this booking. Your submitted ID must confirm the saved birth date."
                : draft.customerInfo.birthDate
                  ? "Choose rental dates that overlap your birth month to unlock this perk."
                  : "Add your birth date in Rental Details; it must match your valid ID."}
            </small>
          </p>
        </div>
        <div>
          <span className={styles.perkIcon} aria-hidden="true">11TH</span>
          <p>
            <strong>Loyalty reward: ₱200 off</strong>
            <small>
              {pricing.loyaltyDiscountAmount > 0
                ? "Automatically applied to this rewarded rental."
                : rewardProgress.loyaltyRewardUsed
                  ? `Reward already applied${rewardProgress.activeRewardBookingRef ? ` to ${rewardProgress.activeRewardBookingRef}` : ""}.`
                  : `${Math.min(rewardProgress.completedRentals, COMPLETED_RENTALS_BEFORE_REWARD)} of ${COMPLETED_RENTALS_BEFORE_REWARD} completed rentals toward your 11th-rental reward.`}
            </small>
          </p>
        </div>
      </div>

      <fieldset className={styles.options} disabled={opening || paid}>
        <legend>Choose a payment option</legend>
        <label className={styles.option}>
          <input
            type="radio"
            name="paymentOption"
            checked={draft.paymentOption === "deposit_50"}
            onChange={() => onPaymentOptionChange("deposit_50")}
          />
          <span>
            <strong>Pay 50% to reserve</strong>
            <small>{money(Math.round(pricing.finalAmount * 50) / 100)} due now</small>
          </span>
        </label>
        <label className={styles.option}>
          <input
            type="radio"
            name="paymentOption"
            checked={draft.paymentOption === "full"}
            onChange={() => onPaymentOptionChange("full")}
          />
          <span>
            <strong>Pay in full</strong>
            <small>{money(pricing.finalAmount)} due now</small>
          </span>
        </label>
      </fieldset>

      <dl className={styles.summary}>
        <div>
          <dt>Product subtotal ({pricing.quantity} × {pricing.rentalDays} {pricing.rentalDays === 1 ? "day" : "days"})</dt>
          <dd>{money(pricing.listSubtotal)}</dd>
        </div>
        {pricing.catalogDiscountAmount > 0 ? (
          <div>
            <dt>{product.discountLabel || "Catalog discount"}</dt>
            <dd className={styles.savings}>-{money(pricing.catalogDiscountAmount)}</dd>
          </div>
        ) : null}
        {pricing.birthdayDiscountAmount > 0 ? (
          <div>
            <dt>Birthday month perk</dt>
            <dd className={styles.savings}>-{money(pricing.birthdayDiscountAmount)}</dd>
          </div>
        ) : null}
        {pricing.loyaltyDiscountAmount > 0 ? (
          <div>
            <dt>11th-rental loyalty reward</dt>
            <dd className={styles.savings}>-{money(pricing.loyaltyDiscountAmount)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Rental subtotal</dt>
          <dd>{money(pricing.rentalSubtotal)}</dd>
        </div>
        <div>
          <dt>Non-refundable deposit</dt>
          <dd>{money(pricing.depositAmount)}</dd>
        </div>
        <div>
          <dt>Online fees</dt>
          <dd>{pricing.fees > 0 ? money(pricing.fees) : "Free"}</dd>
        </div>
        <div className={styles.finalAmount}>
          <dt>Final amount</dt>
          <dd>{money(pricing.finalAmount)}</dd>
        </div>
        <div>
          <dt>Amount due now</dt>
          <dd>{money(dueNow)}</dd>
        </div>
        <div>
          <dt>Balance after payment</dt>
          <dd>{money(Math.max(0, pricing.finalAmount - dueNow))}</dd>
        </div>
      </dl>

      <p className={styles.feeNote}>
        Delivery courier costs are arranged separately with the business and are not part of this online payment.
      </p>

      {bookingNumber ? <p className={styles.reference}>Reservation: {bookingNumber}</p> : null}

      {checking ? (
        <p className={styles.notice}>Confirming the payment with PayMongo…</p>
      ) : paid ? (
        <p className={styles.success}>
          {isDemoPayment
            ? "Demo payment recorded for flow testing. No money was processed. Continue with your verification documents."
            : "Payment verified. Your reservation is secured. Continue with your verification documents."}
        </p>
      ) : null}

      {error ? (
        <p className={formStyles.errorText} role="alert">
          {error}
        </p>
      ) : null}

      <div className={sharedStyles.footer}>
        <button
          type="button"
          className={formStyles.secondaryButton}
          onClick={onBack}
          disabled={opening || checking || !!bookingNumber}
        >
          Back
        </button>
        {paid ? (
          <button type="button" className={formStyles.primaryButton} onClick={onContinue}>
            Continue to Verification
          </button>
        ) : (
          <button
            type="button"
            className={formStyles.primaryButton}
            onClick={onPay}
            disabled={opening || checking}
          >
            {opening ? "Opening PayMongo…" : "Pay Securely with PayMongo"}
          </button>
        )}
      </div>
    </div>
  );
}
