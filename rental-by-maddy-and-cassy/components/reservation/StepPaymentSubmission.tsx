"use client";

import { useState } from "react";
import type { Product } from "@/types/product";
import type { ManualPaymentDraft, ReservationDraft } from "@/src/types/reservationDraft";
import { calculateReservationPricing } from "@/src/lib/reservationPricing";
import {
  COMPLETED_RENTALS_BEFORE_REWARD,
  type RewardProgress,
} from "@/src/lib/promotions";
import FileUploadField from "@/components/file-upload/FileUploadField";
import GcashRecipientCard from "@/components/payment/GcashRecipientCard";
import { scrollToFirstError } from "@/src/lib/formScroll";
import formStyles from "@/components/ui/Form.module.css";
import sharedStyles from "./StepShared.module.css";
import styles from "./StepPaymentSubmission.module.css";

type PaymentErrors = Partial<Record<string, string>>;

const FIELD_ORDER = ["pay-reference", "pay-account-name", "pay-account-number", "pay-proof"];

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
  isGuest?: boolean;
  paymentState: BookingPaymentState;
  isDemoPayment?: boolean;
  bookingId?: string;
  bookingNumber?: string;
  receiptReady?: boolean;
  opening: boolean;
  checking: boolean;
  error: string | null;
  onPaymentOptionChange: (option: "deposit_50" | "full") => void;
  onManualPaymentUpdate: (patch: Partial<ManualPaymentDraft>) => void;
  onBack: () => void;
  onContinue: () => void;
}

export default function StepPaymentSubmission({
  product,
  draft,
  rewardProgress,
  isGuest = false,
  paymentState,
  bookingNumber,
  opening,
  error,
  onPaymentOptionChange,
  onManualPaymentUpdate,
  onBack,
  onContinue,
}: StepPaymentSubmissionProps) {
  const [errors, setErrors] = useState<PaymentErrors>({});
  const pricing = calculateReservationPricing(product, draft, rewardProgress, isGuest);
  const dueNow = draft.paymentOption === "deposit_50"
    ? Math.round(pricing.finalAmount * 50) / 100
    : pricing.finalAmount;
  // A resumed session (e.g. a different device/browser) already has its
  // payment submission recorded server-side even though the local draft's
  // manual-payment fields are empty -- don't re-require them in that case.
  const alreadySubmitted = paymentState !== "unpaid";

  function clearFieldError(field: string) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validate(): boolean {
    if (alreadySubmitted) {
      setErrors({});
      return true;
    }
    const nextErrors: PaymentErrors = {};
    if (!draft.manualPayment.referenceNumber.trim()) {
      nextErrors["pay-reference"] = "Enter the GCash reference number for your payment.";
    }
    if (!draft.manualPayment.accountName.trim()) {
      nextErrors["pay-account-name"] = "Enter the name of the account used to pay.";
    }
    if (!draft.manualPayment.accountNumber.trim()) {
      nextErrors["pay-account-number"] = "Enter the mobile number or account number used to pay.";
    }
    if (!draft.manualPayment.proofFile) {
      nextErrors["pay-proof"] = "Upload a screenshot or proof of payment.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      scrollToFirstError(FIELD_ORDER, nextErrors);
    }
    return Object.keys(nextErrors).length === 0;
  }

  function handleContinue() {
    if (validate()) onContinue();
  }

  return (
    <div className={sharedStyles.wrapper}>
      <h2 className={sharedStyles.heading}>Payment Submission</h2>
      <p className={sharedStyles.subheading}>
        Choose how much to pay now, then pay manually via GCash and submit your proof of payment below.
      </p>

      <div className={styles.guarantee}>
        <strong>Your selected rental dates are secured once our team verifies your submitted payment.</strong>
        <span>
          Paying 50% guarantees the reservation while leaving the remaining balance visible in
          your account. The reservation payment and listed deposit are non-refundable. Paying in
          full settles the online booking amount immediately.
        </span>
      </div>

      {!isGuest ? (
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
      ) : null}

      <fieldset className={styles.options} disabled={opening}>
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

      <h3 className={sharedStyles.sectionHeading}>Pay via GCash</h3>
      <GcashRecipientCard
        instruction={<>Send your <strong>{money(dueNow)}</strong> amount due now to the GCash account above, then fill out your proof of payment below so we can verify your reservation.</>}
      />

      <h3 className={sharedStyles.sectionHeading}>Payment Summary</h3>
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
          <dt>{pricing.fees > 0 ? "Outside-hours service fee" : "Online fees"}</dt>
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

      <h3 className={sharedStyles.sectionHeading}>Proof of Payment</h3>
      {alreadySubmitted ? (
        <div className={styles.guarantee}>
          <strong>
            {paymentState === "pending"
              ? "Your payment proof was already submitted and is awaiting verification."
              : "Your payment has already been verified."}
          </strong>
          <span>You don&apos;t need to submit it again. Continue to the next step below.</span>
        </div>
      ) : null}
      <div className={formStyles.row}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="pay-reference">
            Reference number<span className={formStyles.required}>*</span>
          </label>
          <input
            id="pay-reference"
            className={`${formStyles.input} ${errors["pay-reference"] ? formStyles.inputError : ""}`}
            value={draft.manualPayment.referenceNumber}
            onChange={(event) => {
              const value = event.target.value;
              onManualPaymentUpdate({ referenceNumber: value });
              if (value.trim()) clearFieldError("pay-reference");
            }}
            disabled={opening}
          />
          {errors["pay-reference"] ? <p className={formStyles.errorText}>{errors["pay-reference"]}</p> : null}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="pay-account-name">
            Name of account used<span className={formStyles.required}>*</span>
          </label>
          <input
            id="pay-account-name"
            className={`${formStyles.input} ${errors["pay-account-name"] ? formStyles.inputError : ""}`}
            value={draft.manualPayment.accountName}
            onChange={(event) => {
              const value = event.target.value;
              onManualPaymentUpdate({ accountName: value });
              if (value.trim()) clearFieldError("pay-account-name");
            }}
            disabled={opening}
          />
          {errors["pay-account-name"] ? <p className={formStyles.errorText}>{errors["pay-account-name"]}</p> : null}
        </div>
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="pay-account-number">
          Mobile number / account number used<span className={formStyles.required}>*</span>
        </label>
        <input
          id="pay-account-number"
          className={`${formStyles.input} ${errors["pay-account-number"] ? formStyles.inputError : ""}`}
          value={draft.manualPayment.accountNumber}
          onChange={(event) => {
            const value = event.target.value;
            onManualPaymentUpdate({ accountNumber: value });
            if (value.trim()) clearFieldError("pay-account-number");
          }}
          disabled={opening}
        />
        {errors["pay-account-number"] ? <p className={formStyles.errorText}>{errors["pay-account-number"]}</p> : null}
      </div>

      <FileUploadField
        id="pay-proof"
        label="Screenshot / proof of payment"
        required
        errorMessage={errors["pay-proof"]}
        value={draft.manualPayment.proofFile}
        onChange={(file) => onManualPaymentUpdate({ proofFile: file })}
      />

      {bookingNumber ? <p className={styles.reference}>Reservation: {bookingNumber}</p> : null}

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
          disabled={opening || !!bookingNumber}
        >
          Back
        </button>
        <button
          type="button"
          className={formStyles.primaryButton}
          onClick={handleContinue}
          disabled={opening}
        >
          {opening
            ? "Saving your reservation…"
            : alreadySubmitted
              ? "Continue"
              : "Submit Payment & Continue"}
        </button>
      </div>
    </div>
  );
}
