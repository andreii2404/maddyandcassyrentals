"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import { submitManualPayment, updateBalancePaymentPreference } from "@/src/services/paymentService";
import FileUploadField from "@/components/file-upload/FileUploadField";
import GcashRecipientCard from "@/components/payment/GcashRecipientCard";
import formStyles from "@/components/ui/Form.module.css";
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
  const [submitting, setSubmitting] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [balancePreference, setBalancePreference] = useState(booking.balancePaymentPreference);
  const [savingPreference, setSavingPreference] = useState(false);

  const hasPendingPayment = payments.some((payment) => ["submitted", "under_review"].includes(payment.status));
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
      ? hasPendingPayment
        ? "pending"
        : "unpaid"
      : balanceDue <= 0.01
        ? "paid"
        : "partially_paid";

  const paymentAvailable = ["pending", "approved", "confirmed", "ready_for_release", "released"].includes(booking.status);
  const dueNow = paymentStatus === "partially_paid" ? balanceDue : totalAmount;
  const pickupDeadline = new Date(booking.startDate).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const showGcashForm = paymentStatus !== "partially_paid" || balancePreference === "online_gcash";

  async function chooseBalancePreference(preference: "online_gcash" | "in_person") {
    if (preference === balancePreference || savingPreference) return;
    setSavingPreference(true);
    try {
      await updateBalancePaymentPreference(booking.id, preference);
      setBalancePreference(preference);
      showToast(
        preference === "in_person"
          ? "Your remaining balance is marked for in-person payment."
          : "Your remaining balance is set for online GCash payment.",
        "success",
      );
      await onPaymentUpdated?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The balance option could not be saved.", "error");
    } finally {
      setSavingPreference(false);
    }
  }

  function validate(): boolean {
    const nextErrors: string[] = [];
    if (!referenceNumber.trim()) nextErrors.push("Enter the GCash reference number for your payment.");
    if (!accountName.trim()) nextErrors.push("Enter the name of the account used to pay.");
    if (!accountNumber.trim()) nextErrors.push("Enter the mobile number or account number used to pay.");
    if (!proofFile) nextErrors.push("Upload a screenshot or proof of payment.");
    setErrors(nextErrors);
    return nextErrors.length === 0;
  }

  async function handleSubmit() {
    if (!validate() || !proofFile) return;
    setSubmitting(true);
    try {
      await submitManualPayment(booking.id, {
        referenceNumber: referenceNumber.trim(),
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        paymentOption: paymentStatus === "partially_paid" ? "balance" : "full",
        proofFile,
      });
      setReferenceNumber("");
      setAccountName("");
      setAccountNumber("");
      setProofFile(null);
      setErrors([]);
      showToast("Payment proof submitted. Our team will verify it shortly.", "success");
      await onPaymentUpdated?.();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The payment details could not be submitted.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <div className={styles.titleGroup}>
          <span className={styles.secureIcon} aria-hidden="true">✓</span>
          <div>
            <p>GCASH PAYMENT</p>
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

      {paymentStatus === "partially_paid" ? (
        <div className={styles.paymentPlan} aria-label="Payment schedule">
          <div className={styles.planComplete}>
            <span aria-hidden="true">✓</span>
            <div><small>Reservation payment</small><strong>{money(amountPaid)} verified</strong></div>
          </div>
          <div className={styles.planCurrent}>
            <span aria-hidden="true">2</span>
            <div><small>Remaining balance</small><strong>{money(balanceDue)} due by {pickupDeadline}</strong></div>
          </div>
        </div>
      ) : null}

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
        <div><strong>GCash</strong><span>Manual transfer</span></div>
        <div><strong>{amountPaid > 0 ? "Recorded" : "Reviewed"}</strong><span>{amountPaid > 0 ? "Payment saved" : "Verified by our team"}</span></div>
        <div><strong>{paymentStatus === "paid" ? "Ready" : "Manual"}</strong><span>{paymentStatus === "paid" ? "Receipt available" : "Status updates"}</span></div>
      </div>

      {paymentStatus === "paid" ? (
        <p className={styles.message}>
          {isDemoPayment
            ? "This is a development flow test. No money was processed, and all generated documents are marked as demo records."
            : "Your payment has been verified. Your official receipt and finalized agreement are available under Documents."}
        </p>
      ) : hasPendingPayment ? (
        <p className={styles.message}>
          Your GCash payment proof was submitted and is awaiting verification by our team. You&apos;ll be notified once it&apos;s reviewed.
        </p>
      ) : paymentAvailable ? (
        <>
          <p className={styles.message}>
            {paymentStatus === "partially_paid"
              ? "Choose how you want to settle the remaining balance. You may change this choice anytime before the booking is closed."
              : <>Send <strong>{money(dueNow)}</strong> via GCash to the account below, then submit your proof of payment.</>}
          </p>

          {paymentStatus === "partially_paid" ? (
            <div className={styles.channelChoices} aria-label="Remaining balance payment method">
              <button
                type="button"
                className={balancePreference === "online_gcash" ? styles.channelSelected : styles.channelChoice}
                onClick={() => void chooseBalancePreference("online_gcash")}
                disabled={savingPreference}
              >
                <span>ONLINE</span>
                <strong>Pay through GCash</strong>
                <small>Scan the QR, submit proof, and receive a receipt after verification.</small>
              </button>
              <button
                type="button"
                className={balancePreference === "in_person" ? styles.channelSelected : styles.channelChoice}
                onClick={() => void chooseBalancePreference("in_person")}
                disabled={savingPreference}
              >
                <span>AT HANDOVER</span>
                <strong>Pay in person</strong>
                <small>Pay by cash or GCash when you receive the rental. Admin records your receipt.</small>
              </button>
            </div>
          ) : null}

          {paymentStatus === "partially_paid" && balancePreference === "in_person" ? (
            <div className={styles.inPersonNotice}>
              <span aria-hidden="true">✓</span>
              <div>
                <strong>In-person payment selected</strong>
                <p>Prepare <b>{money(balanceDue)}</b> for pickup or delivery. This balance is only marked paid after an administrator records the cash or GCash transaction.</p>
              </div>
            </div>
          ) : null}

          {showGcashForm ? <><GcashRecipientCard compact />

          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="panel-pay-reference">
              Reference number<span className={formStyles.required}>*</span>
            </label>
            <input
              id="panel-pay-reference"
              className={formStyles.input}
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="panel-pay-account-name">
              Name of account used<span className={formStyles.required}>*</span>
            </label>
            <input
              id="panel-pay-account-name"
              className={formStyles.input}
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="panel-pay-account-number">
              Mobile number / account number used<span className={formStyles.required}>*</span>
            </label>
            <input
              id="panel-pay-account-number"
              className={formStyles.input}
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              disabled={submitting}
            />
          </div>
          <FileUploadField
            label="Screenshot / proof of payment"
            required
            value={proofFile}
            onChange={setProofFile}
          />

          {errors.length > 0 ? (
            <ul className={formStyles.errorText} role="alert">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}

          <button className={styles.submitButton} type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Submitting payment…" : "Submit Payment Proof"}
          </button>
          </> : null}
        </>
      ) : (
        <p className={styles.message}>Payment is unavailable because this booking is no longer active.</p>
      )}

      {latestPayment?.externalReference ? <small>Payment reference: {latestPayment.externalReference}</small> : null}
    </section>
  );
}
