"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import {
  recordInPersonBalance,
  reviewManualPayment,
  setBookingPayLaterOverride,
} from "@/src/services/paymentService";
import type { Booking } from "@/src/types/booking";
import type { PaymentRecord } from "@/src/types/payment";
import styles from "./PaymentsReviewPanel.module.css";

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila" });
}

function formatStage(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function PaymentsReviewPanel({
  bookingId,
  booking,
  payments,
  onOpenProof,
  onUpdated,
}: {
  bookingId: string;
  booking: Booking;
  payments: PaymentRecord[];
  onOpenProof(payment: PaymentRecord): void;
  onUpdated(): Promise<void>;
}) {
  const { showToast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordMethod, setRecordMethod] = useState<"cash" | "gcash_in_person">("cash");
  const [recordReference, setRecordReference] = useState("");
  const [recordNotes, setRecordNotes] = useState("");
  const [exceptionNote, setExceptionNote] = useState(booking.payLaterNote ?? "");

  const needsReview = payments.filter((p) => p.status === "submitted" || p.status === "under_review");
  const reviewed = payments.filter((p) => p.status !== "submitted" && p.status !== "under_review");
  const amountPaid = payments.filter((payment) => payment.status === "verified").reduce((sum, payment) => sum + payment.amount, 0);
  const balanceDue = Math.max(0, booking.totalAmount - amountPaid);

  async function saveInPersonPayment() {
    setRecording(true);
    try {
      await recordInPersonBalance(bookingId, recordMethod, recordReference.trim() || undefined, recordNotes.trim() || undefined);
      setRecordReference("");
      setRecordNotes("");
      await onUpdated();
      showToast("In-person balance recorded. The receipt is now available to the customer.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The in-person payment could not be recorded.", "error");
    } finally {
      setRecording(false);
    }
  }

  async function savePayLater(allowed: boolean) {
    if (allowed && !exceptionNote.trim()) {
      showToast("Add the approved pay-later arrangement before enabling the exception.", "error");
      return;
    }
    setRecording(true);
    try {
      await setBookingPayLaterOverride(bookingId, allowed, allowed ? exceptionNote.trim() : undefined);
      await onUpdated();
      showToast(allowed ? "Pay-later exception enabled." : "Pay-later exception removed.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The pay-later exception could not be saved.", "error");
    } finally {
      setRecording(false);
    }
  }

  async function saveReview(payment: PaymentRecord, status: "verified" | "rejected") {
    const rejectionReason = status === "rejected" ? reason.trim() : "";
    if (status === "rejected" && !rejectionReason) {
      showToast("Explain why this payment proof is being rejected.", "error");
      return;
    }
    setActiveId(payment.id);
    try {
      await reviewManualPayment(bookingId, payment.id, status, rejectionReason || undefined);
      setReason("");
      setRejectingId(null);
      await onUpdated();
      showToast(status === "verified" ? "Payment verified." : "Payment proof rejected.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The payment review could not be saved.", "error");
    } finally {
      setActiveId(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="payment-review-heading">
      <div className={styles.panelHeader}>
        <div>
          <p>ADMIN REVIEW WORKSPACE</p>
          <h3 id="payment-review-heading">Verify submitted GCash payments</h3>
          <span>Open each proof, confirm the transfer, then record one decision.</span>
        </div>
        {needsReview.length ? (
          <div className={styles.reviewCount}>
            <strong>{needsReview.length}</strong>
            <span>needs review</span>
          </div>
        ) : null}
      </div>

      {balanceDue > 0.01 ? (
        <div className={styles.balanceWorkspace}>
          <div className={styles.balanceHeader}>
            <div>
              <span>REMAINING BALANCE</span>
              <strong>{money(balanceDue)}</strong>
              <small>
                Customer preference: {booking.balancePaymentPreference === "in_person" ? "Pay in person" : "Online GCash"}
              </small>
            </div>
            <span className={styles.balanceDue}>Due before handover</span>
          </div>

          <details className={styles.collectionPanel} open={booking.balancePaymentPreference === "in_person"}>
            <summary>Record payment received in person</summary>
            <div className={styles.collectionForm}>
              <label>
                <span>Payment received through</span>
                <select value={recordMethod} onChange={(event) => setRecordMethod(event.target.value as "cash" | "gcash_in_person")} disabled={recording}>
                  <option value="cash">Cash</option>
                  <option value="gcash_in_person">GCash shown/paid in person</option>
                </select>
              </label>
              <label>
                <span>Reference number (optional)</span>
                <input value={recordReference} onChange={(event) => setRecordReference(event.target.value)} maxLength={120} disabled={recording} />
              </label>
              <label className={styles.fullField}>
                <span>Collection note (optional)</span>
                <textarea value={recordNotes} onChange={(event) => setRecordNotes(event.target.value)} rows={2} maxLength={1000} disabled={recording} placeholder="Who received it, where, or any useful handover note" />
              </label>
              <button type="button" className={styles.recordButton} onClick={() => void saveInPersonPayment()} disabled={recording || needsReview.length > 0}>
                {recording ? "Recording…" : `Record ${money(balanceDue)} as paid`}
              </button>
              {needsReview.length > 0 ? <small className={styles.collectionWarning}>Review the pending online proof before recording another payment.</small> : null}
            </div>
          </details>

          <details className={styles.exceptionPanel} open={booking.payLaterAllowed}>
            <summary>Exceptional pay-later arrangement</summary>
            <div className={styles.exceptionBody}>
              <p>Handover is blocked until the balance is fully paid. Only enable this when the business explicitly approves collection after handover.</p>
              <textarea value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} rows={2} maxLength={1000} placeholder="Required: explain the approved arrangement" disabled={recording} />
              <button type="button" onClick={() => void savePayLater(!booking.payLaterAllowed)} disabled={recording || (!booking.payLaterAllowed && !exceptionNote.trim())}>
                {booking.payLaterAllowed ? "Remove pay-later exception" : "Allow handover with balance"}
              </button>
            </div>
          </details>
        </div>
      ) : (
        <p className={styles.fullyPaid}>✓ Fully paid — handover payment requirement complete.</p>
      )}

      <div className={styles.list}>
        {payments.length === 0 ? <p className={styles.empty}>No payment submissions yet.</p> : null}
        {[...needsReview, ...reviewed].map((payment) => {
          const isSaving = activeId === payment.id;
          const isRejecting = rejectingId === payment.id;
          const metadata = payment.providerMetadata as { accountName?: string; accountNumber?: string };
          const actionable = payment.status === "submitted" || payment.status === "under_review";
          return (
            <article key={payment.id} className={`${styles.card} ${styles[payment.status] ?? ""}`}>
              <div className={styles.topline}>
                <div className={styles.summary}>
                  <strong>{money(payment.amount)}</strong>
                  <span>{formatStage(payment.stage)} · {payment.paymentMethod?.toUpperCase() || "MANUAL"}</span>
                </div>
                <span className={`${styles.statusPill} ${styles[payment.status] ?? ""}`}>{formatStage(payment.status)}</span>
              </div>

              <dl className={styles.facts}>
                <div><dt>Reference</dt><dd>{payment.externalReference || "-"}</dd></div>
                <div><dt>Paid from</dt><dd>{metadata.accountName || "-"}{metadata.accountNumber ? ` (${metadata.accountNumber})` : ""}</dd></div>
                <div><dt>Submitted</dt><dd>{formatDate(payment.submittedAt)}</dd></div>
              </dl>

              {payment.reviewNotes ? (
                <div className={styles.note}>
                  <strong>Review note</strong>
                  <p>{payment.reviewNotes}</p>
                </div>
              ) : null}

              <div className={styles.actions}>
                {payment.proofStoragePath ? (
                  <button type="button" className={styles.openButton} onClick={() => onOpenProof(payment)} disabled={activeId !== null}>
                    Open proof
                  </button>
                ) : null}
                {actionable ? (
                  <>
                    <button
                      type="button"
                      className={styles.approveButton}
                      onClick={() => void saveReview(payment, "verified")}
                      disabled={activeId !== null}
                    >
                      {isSaving && !isRejecting ? "Saving..." : "Verify payment"}
                    </button>
                    <button
                      type="button"
                      className={styles.rejectButton}
                      onClick={() => { setRejectingId(payment.id); setReason(""); }}
                      disabled={activeId !== null}
                    >
                      Reject
                    </button>
                  </>
                ) : null}
              </div>

              {isRejecting ? (
                <div className={styles.rejectEditor}>
                  <label>
                    <span>Why is this payment proof being rejected?</span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Example: The reference number doesn't match any transaction we received."
                      autoFocus
                    />
                  </label>
                  <div>
                    <button type="button" onClick={() => { setRejectingId(null); setReason(""); }} disabled={isSaving}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.sendButton}
                      onClick={() => void saveReview(payment, "rejected")}
                      disabled={isSaving || !reason.trim()}
                    >
                      {isSaving ? "Sending..." : "Send rejection"}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
