"use client";

import { useState } from "react";
import Image from "next/image";
import { useToast } from "@/components/ui/ToastProvider";
import { submitManualGcashPayment } from "@/src/services/paymentService";
import type { Booking } from "@/src/types/booking";
import type { PaymentRecord } from "@/src/types/payment";
import styles from "./BookingPaymentPanel.module.css";
import { isValidGcashReference, normalizeGcashReference } from "@/src/lib/manualGcash";

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const latestPayment = [...payments].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const amountPaid = payments.filter((payment) => payment.status === "verified").reduce((sum, payment) => sum + payment.amount, 0);
  const balanceDue = Math.max(0, booking.totalAmount - amountPaid);
  const hasPendingProof = payments.some((payment) => ["submitted", "under_review"].includes(payment.status));
  const paymentStatus: "unpaid" | "pending" | "partially_paid" | "paid" = balanceDue <= 0.01
    ? "paid"
    : hasPendingProof ? "pending" : amountPaid > 0 ? "partially_paid" : "unpaid";
  const paymentAvailable = ["pending", "approved", "confirmed"].includes(booking.status);

  async function handleSubmit() {
    if (!proofFile) return;
    setSubmitting(true);
    try {
      await submitManualGcashPayment({ bookingId: booking.id, paymentOption: amountPaid > 0 ? "balance" : "full", referenceNumber, proofFile });
      showToast("GCash payment proof submitted for admin verification.", "success");
      setShowForm(false);
      setReferenceNumber("");
      setProofFile(null);
      await onPaymentUpdated?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The GCash proof could not be submitted.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <div className={styles.titleGroup}>
          <span className={styles.secureIcon} aria-hidden="true">✓</span>
          <div><p>MANUAL GCASH PAYMENT</p><h3>{paymentStatus === "paid" ? "Payment confirmed" : "Rental payment"}</h3></div>
        </div>
        <span className={`${styles.status} ${styles[paymentStatus]}`}>{paymentStatus.replaceAll("_", " ")}</span>
      </div>
      <div className={styles.amountRow}>
        <span>{paymentStatus === "paid" ? "Total paid" : amountPaid > 0 ? "Remaining balance" : "Booking total"}</span>
        <strong>{money(paymentStatus === "paid" ? amountPaid : balanceDue)}</strong>
      </div>
      <dl className={styles.breakdown}>
        <div><dt>Rental subtotal</dt><dd>{money(booking.rentalSubtotal)}</dd></div>
        {booking.birthdayDiscountAmount > 0 ? <div><dt>Birthday month perk</dt><dd>-{money(booking.birthdayDiscountAmount)}</dd></div> : null}
        {booking.loyaltyDiscountAmount > 0 ? <div><dt>11th-rental loyalty reward</dt><dd>-{money(booking.loyaltyDiscountAmount)}</dd></div> : null}
        <div><dt>Non-refundable deposit</dt><dd>{money(booking.refundableDeposit)}</dd></div>
        {booking.pickupConvenienceFee ? <div><dt>Outside-hours service fee</dt><dd>{money(booking.pickupConvenienceFee)}</dd></div> : null}
        {booking.deliveryFee > 0 ? <div><dt>Delivery fee</dt><dd>{money(booking.deliveryFee)}</dd></div> : null}
        <div><dt>Verified amount</dt><dd>{money(amountPaid)}</dd></div>
      </dl>
      {paymentStatus === "paid" ? (
        <p className={styles.message}>Your GCash payment is verified. The official receipt is available under Documents.</p>
      ) : paymentStatus === "pending" ? (
        <p className={styles.message}>Your latest GCash proof is awaiting admin verification. You will receive an update after review.</p>
      ) : paymentAvailable ? (
        !showForm ? (
          <button type="button" onClick={() => setShowForm(true)}>{amountPaid > 0 ? "Pay Remaining Balance via GCash" : "Pay via GCash"}</button>
        ) : (
          <div className={styles.manualForm}>
            <div className={styles.qrWrap}>
              <Image src="/images/payment/gcash-qr.png" alt="Official GCash QR code" width={1152} height={1152} />
              <a href="/images/payment/gcash-qr.png" download="maddy-cassy-gcash-qr.png">Download QR</a>
            </div>
            <div className={styles.manualFields}>
              <strong>Pay exactly {money(balanceDue)}</strong>
              <p>Confirm the recipient in GCash, send the exact amount, then upload the successful receipt.</p>
              <label><span>GCash reference number</span><input value={referenceNumber} onChange={(event) => setReferenceNumber(normalizeGcashReference(event.target.value))} /></label>
              <label><span>Payment proof</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setProofFile(event.target.files?.[0] ?? null)} /></label>
              <div className={styles.manualActions}>
                <button type="button" className={styles.secondary} onClick={() => setShowForm(false)} disabled={submitting}>Cancel</button>
                <button type="button" onClick={() => void handleSubmit()} disabled={submitting || !proofFile || !isValidGcashReference(referenceNumber)}>{submitting ? "Submitting..." : "Submit Proof"}</button>
              </div>
            </div>
          </div>
        )
      ) : <p className={styles.message}>Payment is unavailable because this booking is no longer active.</p>}
      {latestPayment?.externalReference ? <small>Latest GCash reference: {latestPayment.externalReference}</small> : null}
    </section>
  );
}
