"use client";

import type { Product } from "@/types/product";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import { getDayCount } from "@/src/types/reservationDraft";
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
  const total = product.pricePerDay * getDayCount(draft.startDate, draft.endDate);
  const listTotal = product.listPricePerDay * getDayCount(draft.startDate, draft.endDate);
  const discountSavings = Math.max(0, listTotal - total);
  const dueNow = draft.paymentOption === "deposit_50" ? Math.round(total * 50) / 100 : total;
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
          your account. Paying in full settles the rental amount immediately.
        </span>
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
            <small>{money(Math.round(total * 50) / 100)} due now</small>
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
            <small>{money(total)} due now</small>
          </span>
        </label>
      </fieldset>

      <dl className={styles.summary}>
        {discountSavings > 0 ? (
          <div>
            <dt>{product.discountLabel || "Catalog discount"}</dt>
            <dd className={styles.savings}>-{money(discountSavings)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Rental total</dt>
          <dd>{money(total)}</dd>
        </div>
        <div>
          <dt>Amount due now</dt>
          <dd>{money(dueNow)}</dd>
        </div>
        <div>
          <dt>Balance after payment</dt>
          <dd>{money(Math.max(0, total - dueNow))}</dd>
        </div>
      </dl>

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
