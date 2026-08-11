"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import { createPaymentCheckout, reconcilePayment } from "@/src/services/paymentService";
import type { Booking } from "@/src/types/booking";
import type { PaymentRecord } from "@/src/types/payment";
import styles from "./BookingPaymentPanel.module.css";

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function BookingPaymentPanel({
  booking,
  payments,
  onPaymentUpdated,
}: {
  booking: Booking;
  payments: PaymentRecord[];
  onPaymentUpdated?: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const [opening, setOpening] = useState(false);
  const [confirmingReturn, setConfirmingReturn] = useState(false);
  const returnHandledRef = useRef(false);
  const hasPendingPayment = payments.some((payment) => payment.status === "submitted");

  useEffect(() => {
    if (returnHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const returnedFromPayment = params.get("payment") === "success";
    // Also reconcile an existing submitted payment when the customer had to
    // sign in again and the old redirect lost its payment marker. This safely
    // recovers a paid PayMongo checkout before offering another checkout.
    if (!returnedFromPayment && !hasPendingPayment) return;

    returnHandledRef.current = true;
    let cancelled = false;
    let timer: number | undefined;

    const clearReturnMarker = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("payment");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    };

    async function confirmPayment(attempt = 0): Promise<void> {
      try {
        const status = await reconcilePayment(booking.id);
        if (cancelled) return;
        if (status === "verified") {
          clearReturnMarker();
          setConfirmingReturn(false);
          showToast("Payment verified. Your receipt is being prepared.", "success");
          await onPaymentUpdated?.();
          return;
        }
        if (status === "failed") {
          clearReturnMarker();
          setConfirmingReturn(false);
          showToast("PayMongo reported that this payment was not completed.", "error");
          await onPaymentUpdated?.();
          return;
        }
        if (returnedFromPayment && attempt < 14) {
          timer = window.setTimeout(() => void confirmPayment(attempt + 1), 2000);
          return;
        }
        setConfirmingReturn(false);
        if (returnedFromPayment) {
          showToast("PayMongo is still confirming this payment. Refresh this booking in a moment.", "info");
        }
      } catch (error) {
        if (cancelled) return;
        if (returnedFromPayment && attempt < 14) {
          timer = window.setTimeout(() => void confirmPayment(attempt + 1), 2000);
          return;
        }
        setConfirmingReturn(false);
        if (returnedFromPayment) {
          showToast(
            error instanceof Error ? error.message : "The payment status could not be confirmed.",
            "error",
          );
        }
      }
    }

    timer = window.setTimeout(() => {
      if (cancelled) return;
      setConfirmingReturn(true);
      void confirmPayment();
    }, 0);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [booking.id, hasPendingPayment, onPaymentUpdated, showToast]);

  const latestPayment = [...payments].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )[0];
  const isDemoPayment = payments.some((p) => (p.providerMetadata as { demo?: boolean } | undefined)?.demo === true);
  const amountPaid = payments
    .filter((p) => p.status === "verified")
    .reduce((sum, p) => sum + p.amount, 0);
  const totalAmount = booking.totalAmount;
  const balanceDue = Math.max(0, totalAmount - amountPaid);
  const paymentStatus: "unpaid" | "pending" | "partially_paid" | "paid" =
    amountPaid <= 0
      ? latestPayment && ["submitted", "under_review"].includes(latestPayment.status)
        ? "pending"
        : "unpaid"
      : balanceDue <= 0.01
        ? "paid"
        : "partially_paid";

  const paymentAvailable = ["pending", "approved", "confirmed"].includes(booking.status);

  async function handlePay() {
    setOpening(true);
    try {
      const result = await createPaymentCheckout(booking.id, paymentStatus === "partially_paid" ? "balance" : "full");
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The payment page could not be opened.", "error");
      setOpening(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <div className={styles.titleGroup}>
          <span className={styles.secureIcon} aria-hidden="true">✓</span>
          <div>
            <p>SECURE PAYMENT</p>
            <h3>
              {isDemoPayment
                ? "Demo payment recorded"
                : paymentStatus === "paid"
                  ? "Payment confirmed"
                  : "Rental payment"}
            </h3>
          </div>
        </div>
        <span className={`${styles.status} ${styles[paymentStatus]}`}>{paymentStatus.replaceAll("_", " ")}</span>
      </div>

      <div className={styles.amountRow}>
        <span>
          {paymentStatus === "paid" ? "Total paid" : paymentStatus === "partially_paid" ? "Remaining balance" : "Booking total"}
        </span>
        <strong>{money(paymentStatus === "partially_paid" ? balanceDue : totalAmount)}</strong>
      </div>

      <dl className={styles.breakdown}>
        <div><dt>Rental subtotal</dt><dd>{money(booking.rentalSubtotal)}</dd></div>
        {booking.birthdayDiscountAmount > 0 ? (
          <div><dt>Birthday month perk</dt><dd>-{money(booking.birthdayDiscountAmount)}</dd></div>
        ) : null}
        {booking.loyaltyDiscountAmount > 0 ? (
          <div><dt>11th-rental loyalty reward</dt><dd>-{money(booking.loyaltyDiscountAmount)}</dd></div>
        ) : null}
        <div><dt>Non-refundable deposit</dt><dd>{money(booking.refundableDeposit)}</dd></div>
        {booking.deliveryFee > 0 ? <div><dt>Delivery fee</dt><dd>{money(booking.deliveryFee)}</dd></div> : null}
        <div><dt>Online fees</dt><dd>Free</dd></div>
      </dl>

      <div className={styles.trustRow} aria-label="Payment information">
        <div><strong>PayMongo</strong><span>Hosted checkout</span></div>
        <div><strong>{amountPaid > 0 ? "Recorded" : "Protected"}</strong><span>{amountPaid > 0 ? "Payment saved" : "Secure processing"}</span></div>
        <div><strong>{paymentStatus === "paid" ? "Ready" : "Automatic"}</strong><span>{paymentStatus === "paid" ? "Receipt available" : "Status updates"}</span></div>
      </div>

      {confirmingReturn ? (
        <p className={styles.message}>Confirming your successful PayMongo return and preparing your receipt…</p>
      ) : paymentStatus === "paid" ? (
        <p className={styles.message}>
          {isDemoPayment
            ? "This is a development flow test. No money was processed, and all generated documents are marked as demo records."
            : "PayMongo verified this transaction. Your official receipt and finalized agreement are available under Documents."}
        </p>
      ) : paymentAvailable ? (
        <>
          <p className={styles.message}>
            Continue to PayMongo&apos;s hosted checkout. A verified payment secures your selected
            rental dates. Verification documents are completed afterward.
          </p>
          <button type="button" onClick={handlePay} disabled={opening || confirmingReturn}>
            {opening
              ? "Opening secure checkout..."
              : paymentStatus === "pending"
                ? "Continue Payment"
                : paymentStatus === "partially_paid"
                  ? "Pay Remaining Balance"
                  : "Pay Securely"}
          </button>
        </>
      ) : (
        <p className={styles.message}>Payment is unavailable because this booking is no longer active.</p>
      )}

      {latestPayment?.externalReference ? <small>Payment reference: {latestPayment.externalReference}</small> : null}
    </section>
  );
}
