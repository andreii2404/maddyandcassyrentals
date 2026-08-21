"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
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
import { isValidGcashReference, normalizeGcashReference } from "@/src/lib/manualGcash";

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
  bookingId?: string;
  bookingNumber?: string;
  receiptReady?: boolean;
  opening: boolean;
  checking: boolean;
  error: string | null;
  onPaymentOptionChange: (option: "deposit_50" | "full") => void;
  onBack: () => void;
  onPay: (proofFile: File, referenceNumber: string) => void;
  onContinue: () => void;
}

export default function StepPaymentSubmission({
  product,
  draft,
  rewardProgress,
  paymentState,
  isDemoPayment = false,
  bookingId,
  bookingNumber,
  receiptReady = false,
  opening,
  checking,
  error,
  onPaymentOptionChange,
  onBack,
  onPay,
  onContinue,
}: StepPaymentSubmissionProps) {
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const pricing = calculateReservationPricing(product, draft, rewardProgress);
  const dueNow = draft.paymentOption === "deposit_50"
    ? Math.round(pricing.finalAmount * 50) / 100
    : pricing.finalAmount;
  const paid = paymentState === "paid" || paymentState === "partially_paid";
  const awaitingReview = paymentState === "pending";

  return (
    <div className={sharedStyles.wrapper}>
      <h2 className={sharedStyles.heading}>Payment Submission</h2>
      <p className={sharedStyles.subheading}>
        Choose how much to pay, scan or download the official GCash QR, then submit your payment proof.
      </p>

      <div className={styles.guarantee}>
        <strong>Your selected rental dates are secured after the admin verifies your GCash payment.</strong>
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

      <fieldset className={styles.options} disabled={opening || paid || awaitingReview}>
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

      {!paid && !awaitingReview ? (
        <section className={styles.gcashPanel} aria-labelledby="gcash-payment-heading">
          <div className={styles.qrColumn}>
            <div className={styles.qrFrame}>
              <Image
                src="/images/payment/gcash-qr.png"
                alt="Official GCash QR code for Maddy and Cassy Rentals"
                width={1152}
                height={1152}
                priority
              />
            </div>
            <a href="/images/payment/gcash-qr.png" download="maddy-cassy-gcash-qr.png" className={styles.downloadQr}>
              Download QR code
            </a>
          </div>
          <div className={styles.paymentInstructions}>
            <p className={styles.panelEyebrow}>MANUAL GCASH PAYMENT</p>
            <h3 id="gcash-payment-heading">Pay exactly {money(dueNow)}</h3>
            <ol>
              <li>Open GCash and scan the QR, or download it and upload it from your gallery.</li>
              <li>Confirm the recipient shown by GCash before sending the exact amount.</li>
              <li>Save the successful payment receipt and copy its reference number.</li>
              <li>Upload the receipt below. The admin will verify it before final confirmation.</li>
            </ol>
            <div className={styles.proofFields}>
              <label>
                <span>GCash reference number *</span>
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(normalizeGcashReference(event.target.value))}
                  placeholder="Enter the reference from your receipt"
                />
              </label>
              <label>
                <span>Payment proof *</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => setProofFile(event.target.files?.[0] ?? null)}
                />
                <small>JPG, PNG, WEBP, or PDF · maximum 4MB</small>
              </label>
            </div>
          </div>
        </section>
      ) : null}

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
        The ₱100 service fee applies only when you voluntarily choose pickup or delivery before
        9:00 AM or after 7:00 PM. Delivery courier costs are arranged separately with the business.
      </p>

      {bookingNumber ? <p className={styles.reference}>Reservation: {bookingNumber}</p> : null}

      {checking ? (
        <p className={styles.notice}>Submitting your GCash payment proof securely…</p>
      ) : awaitingReview ? (
        <div className={styles.reviewPending}>
          <strong>Payment proof submitted for verification.</strong>
          <span>You may continue with your documents and agreement. The booking can only be confirmed after an admin verifies the GCash transaction.</span>
        </div>
      ) : paid ? (
        <div className={styles.success}>
          <strong>
            {isDemoPayment
              ? "Demo payment recorded. No money was processed."
              : "Payment verified. Your reservation is secured."}
          </strong>
          <span>
            {receiptReady
              ? "Your official receipt is ready in Payment History."
              : "Your receipt is being prepared and will appear in Payment History shortly."}
          </span>
          {bookingId && receiptReady ? (
            <Link href={`/account/bookings/${bookingId}`}>View booking receipt</Link>
          ) : null}
        </div>
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
        {paid || awaitingReview ? (
          <button type="button" className={formStyles.primaryButton} onClick={onContinue}>
            Continue to Verification
          </button>
        ) : (
          <button
            type="button"
            className={formStyles.primaryButton}
            onClick={() => proofFile && onPay(proofFile, referenceNumber)}
            disabled={opening || checking || !proofFile || !isValidGcashReference(referenceNumber)}
          >
            {opening ? "Submitting proof…" : "Submit GCash Payment Proof"}
          </button>
        )}
      </div>
    </div>
  );
}
