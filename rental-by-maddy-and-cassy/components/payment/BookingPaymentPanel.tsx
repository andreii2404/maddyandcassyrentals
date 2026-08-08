"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import { createPaymentCheckout } from "@/src/services/paymentService";
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
}: {
  booking: Booking;
  payments: PaymentRecord[];
}) {
  const { showToast } = useToast();
  const [opening, setOpening] = useState(false);

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
        <div><dt>Non-refundable deposit</dt><dd>{money(booking.refundableDeposit)}</dd></div>
        {booking.deliveryFee > 0 ? <div><dt>Delivery fee</dt><dd>{money(booking.deliveryFee)}</dd></div> : null}
        <div><dt>Online fees</dt><dd>Free</dd></div>
      </dl>

      {paymentStatus === "paid" ? (
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
          <button type="button" onClick={handlePay} disabled={opening}>
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
