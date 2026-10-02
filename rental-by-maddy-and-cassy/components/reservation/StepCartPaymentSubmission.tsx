"use client";

import { useState } from "react";
import type { ManualPaymentDraft, ReservationDraft } from "@/src/types/reservationDraft";
import type { MultiItemReservationPricing } from "@/src/lib/reservationPricing";
import {
  COMPLETED_RENTALS_BEFORE_REWARD,
  type RewardProgress,
} from "@/src/lib/promotions";
import LineItemsTable from "./LineItemsTable";
import FileUploadField from "@/components/file-upload/FileUploadField";
import GcashRecipientCard from "@/components/payment/GcashRecipientCard";
import {
  ACCOUNT_NAME_MAX_LENGTH,
  isValidAccountName,
  isValidReferenceNumber,
  REFERENCE_NUMBER_MAX_LENGTH,
  sanitizeAccountNameInput,
  sanitizeReferenceNumberInput,
} from "@/src/lib/paymentValidation";
import { scrollToFirstError } from "@/src/lib/formScroll";
import formStyles from "@/components/ui/Form.module.css";
import ReservationFooter from "@/components/reservation/ReservationFooter";
import sharedStyles from "./StepShared.module.css";
import styles from "./StepPaymentSubmission.module.css";

type PaymentErrors = Partial<Record<string, string>>;

const FIELD_ORDER = ["cart-pay-reference", "cart-pay-account-name", "cart-pay-proof"];

function money(currency: string, value: number): string {
  return `${currency}${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export type BookingPaymentState = "unpaid" | "pending" | "partially_paid" | "paid";

interface StepCartPaymentSubmissionProps {
  pricing: MultiItemReservationPricing;
  currency: string;
  draft: ReservationDraft;
  rewardProgress: RewardProgress;
  isGuest?: boolean;
  paymentState: BookingPaymentState;
  bookingNumber?: string;
  opening: boolean;
  error: string | null;
  onPaymentOptionChange: (option: "deposit_50" | "full") => void;
  onManualPaymentUpdate: (patch: Partial<ManualPaymentDraft>) => void;
  onBack: () => void;
  onContinue: () => void;
}

export default function StepCartPaymentSubmission({
  pricing,
  currency,
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
}: StepCartPaymentSubmissionProps) {
  const [errors, setErrors] = useState<PaymentErrors>({});
  const [touched, setTouched] = useState<Partial<Record<string, boolean>>>({});
  const dueNow = draft.paymentOption === "deposit_50"
    ? Math.round(pricing.finalAmount * 50) / 100
    : pricing.finalAmount;
  const alreadySubmitted = paymentState !== "unpaid";

  function validateReferenceField(value: string): string | null {
    if (!value.trim()) return "Enter the reference number for your payment.";
    if (!isValidReferenceNumber(value)) return "Enter a valid reference number using letters, numbers, and hyphens.";
    return null;
  }

  function validateAccountNameField(value: string): string | null {
    if (!value.trim()) return "Enter the name of the account used to pay.";
    if (!isValidAccountName(value)) return "Enter a valid name using letters only.";
    return null;
  }

  function setFieldError(field: string, message: string | null) {
    setErrors((prev) => {
      if (!message) {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      }
      if (prev[field] === message) return prev;
      return { ...prev, [field]: message };
    });
  }

  function handleFieldChange(field: string, message: string | null) {
    if (touched[field] || errors[field]) {
      setFieldError(field, message);
    }
  }

  function handleFieldBlur(field: string, message: string | null) {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
    setFieldError(field, message);
  }

  function validate(): boolean {
    if (alreadySubmitted) {
      setErrors({});
      return true;
    }
    const nextErrors: PaymentErrors = {};
    const referenceError = validateReferenceField(draft.manualPayment.referenceNumber);
    if (referenceError) nextErrors["cart-pay-reference"] = referenceError;
    const accountNameError = validateAccountNameField(draft.manualPayment.accountName);
    if (accountNameError) nextErrors["cart-pay-account-name"] = accountNameError;
    if (!draft.manualPayment.proofFile) {
      nextErrors["cart-pay-proof"] = "Upload a screenshot or proof of payment.";
    }
    setErrors(nextErrors);
    setTouched({
      "cart-pay-reference": true,
      "cart-pay-account-name": true,
      "cart-pay-proof": true,
    });
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
                    : "Add your birth date in the previous step; it must match your valid ID."}
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
            <small>{money(currency, Math.round(pricing.finalAmount * 50) / 100)} due now</small>
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
            <small>{money(currency, pricing.finalAmount)} due now</small>
          </span>
        </label>
      </fieldset>

      <h3 className={sharedStyles.sectionHeading}>Pay via GCash</h3>
      <GcashRecipientCard
        instruction={<>Send your <strong>{money(currency, dueNow)}</strong> amount due now to the GCash account above, then fill out your proof of payment below so we can verify your reservation.</>}
      />

      <h3 className={sharedStyles.sectionHeading}>Items in this booking</h3>
      <LineItemsTable lines={pricing.lines} currency={currency} />

      <h3 className={sharedStyles.sectionHeading}>Payment Summary</h3>
      <dl className={styles.summary}>
        <div>
          <dt>{pricing.productCount} {pricing.productCount === 1 ? "product" : "products"}, {pricing.totalUnits} {pricing.totalUnits === 1 ? "unit" : "units"}</dt>
          <dd>{money(currency, pricing.listSubtotal)}</dd>
        </div>
        {pricing.catalogDiscountAmount > 0 ? (
          <div>
            <dt>Catalog discount</dt>
            <dd className={styles.savings}>-{money(currency, pricing.catalogDiscountAmount)}</dd>
          </div>
        ) : null}
        {pricing.birthdayDiscountAmount > 0 ? (
          <div>
            <dt>Birthday month perk</dt>
            <dd className={styles.savings}>-{money(currency, pricing.birthdayDiscountAmount)}</dd>
          </div>
        ) : null}
        {pricing.loyaltyDiscountAmount > 0 ? (
          <div>
            <dt>11th-rental loyalty reward</dt>
            <dd className={styles.savings}>-{money(currency, pricing.loyaltyDiscountAmount)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Product subtotal</dt>
          <dd>{money(currency, pricing.rentalSubtotal)}</dd>
        </div>
        <div>
          <dt>Non-refundable deposit</dt>
          <dd>{money(currency, pricing.depositAmount)}</dd>
        </div>
        <div>
          <dt>{pricing.fees > 0 ? "Outside-hours service fee" : "Online fees"}</dt>
          <dd>{pricing.fees > 0 ? money(currency, pricing.fees) : "Free"}</dd>
        </div>
        <div className={styles.finalAmount}>
          <dt>Final Grand Total</dt>
          <dd>{money(currency, pricing.finalAmount)}</dd>
        </div>
        <div>
          <dt>Amount due now</dt>
          <dd>{money(currency, dueNow)}</dd>
        </div>
        <div>
          <dt>Balance after payment</dt>
          <dd>{money(currency, Math.max(0, pricing.finalAmount - dueNow))}</dd>
        </div>
      </dl>

      <p className={styles.feeNote}>
        For delivery, courier booking and payment are handled by the customer. Delivery fees are separate from the rental fee and are not part of this online payment.
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
          <label className={formStyles.label} htmlFor="cart-pay-reference">
            Reference number<span className={formStyles.required}>*</span>
          </label>
          <input
            id="cart-pay-reference"
            className={`${formStyles.input} ${errors["cart-pay-reference"] ? formStyles.inputError : ""}`}
            value={draft.manualPayment.referenceNumber}
            maxLength={REFERENCE_NUMBER_MAX_LENGTH}
            aria-invalid={Boolean(errors["cart-pay-reference"])}
            onChange={(event) => {
              const value = sanitizeReferenceNumberInput(event.target.value);
              onManualPaymentUpdate({ referenceNumber: value });
              handleFieldChange("cart-pay-reference", validateReferenceField(value));
            }}
            onBlur={() =>
              handleFieldBlur("cart-pay-reference", validateReferenceField(draft.manualPayment.referenceNumber))
            }
            disabled={opening}
          />
          {errors["cart-pay-reference"] ? <p className={formStyles.errorText}>{errors["cart-pay-reference"]}</p> : null}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="cart-pay-account-name">
            Name of account used<span className={formStyles.required}>*</span>
          </label>
          <input
            id="cart-pay-account-name"
            className={`${formStyles.input} ${errors["cart-pay-account-name"] ? formStyles.inputError : ""}`}
            value={draft.manualPayment.accountName}
            maxLength={ACCOUNT_NAME_MAX_LENGTH}
            aria-invalid={Boolean(errors["cart-pay-account-name"])}
            onChange={(event) => {
              const value = sanitizeAccountNameInput(event.target.value);
              onManualPaymentUpdate({ accountName: value });
              handleFieldChange("cart-pay-account-name", validateAccountNameField(value));
            }}
            onBlur={() =>
              handleFieldBlur("cart-pay-account-name", validateAccountNameField(draft.manualPayment.accountName))
            }
            disabled={opening}
          />
          {errors["cart-pay-account-name"] ? (
            <p className={formStyles.errorText}>{errors["cart-pay-account-name"]}</p>
          ) : null}
        </div>
      </div>


      <FileUploadField
        id="cart-pay-proof"
        label="Screenshot / proof of payment"
        disabled={opening}
        required
        errorMessage={errors["cart-pay-proof"]}
        value={draft.manualPayment.proofFile}
        onChange={(file) => onManualPaymentUpdate({ proofFile: file })}
      />

      {bookingNumber ? <p className={styles.reference}>Reservation: {bookingNumber}</p> : null}

      {error ? (
        <p className={formStyles.errorText} role="alert">
          {error}
        </p>
      ) : null}

      <ReservationFooter
        onBack={onBack}
        backDisabled={opening || !!bookingNumber}
        primaryLabel={opening ? "Saving your reservation…" : alreadySubmitted ? "Continue" : "Submit Payment & Continue"}
        primaryLoading={opening}
        primaryLoadingText="Saving your reservation…"
        primaryDisabled={opening}
        onContinue={handleContinue}
      />
    </div>
  );
}
