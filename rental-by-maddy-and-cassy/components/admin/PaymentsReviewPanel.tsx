"use client";

import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import { recordInPersonBalance, reviewManualPayment } from "@/src/services/paymentService";
import type { Booking } from "@/src/types/booking";
import type { PaymentRecord, PaymentReviewerName, PaymentStage } from "@/src/types/payment";
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

/** "other" is how a single up-front full payment (no prior deposit) is recorded server-side. */
function stageLabel(stage: PaymentStage): string {
  if (stage === "other") return "Full Payment";
  if (stage === "down_payment") return "Down Payment";
  if (stage === "balance") return "Balance Payment";
  return formatStage(stage);
}

type PendingAction =
  | { kind: "verify"; payment: PaymentRecord }
  | { kind: "reject"; payment: PaymentRecord }
  | { kind: "recordBalance" };

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
  const [reason, setReason] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordMethod, setRecordMethod] = useState<"cash" | "gcash_in_person">("cash");
  const [recordReference, setRecordReference] = useState("");
  const [recordNotes, setRecordNotes] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reviewerName, setReviewerName] = useState<PaymentReviewerName>("");

  const needsReview = payments.filter((p) => p.status === "submitted" || p.status === "under_review");
  const reviewed = payments.filter((p) => p.status !== "submitted" && p.status !== "under_review");
  const amountPaid = payments.filter((payment) => payment.status === "verified").reduce((sum, payment) => sum + payment.amount, 0);
  const balanceDue = Math.max(0, booking.totalAmount - amountPaid);

  async function saveInPersonPayment() {
    if (recording || activeId !== null || needsReview.length > 0) return;
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

  async function saveReview(payment: PaymentRecord, status: "verified" | "rejected", reviewer: PaymentReviewerName) {
    if (activeId !== null || recording) return;
    const rejectionReason = status === "rejected" ? reason.trim() : "";
    if (status === "rejected" && !rejectionReason) {
      showToast("Explain why this payment proof is being rejected.", "error");
      return;
    }
    setActiveId(payment.id);
    try {
      await reviewManualPayment(bookingId, payment.id, status, reviewer, rejectionReason || undefined);
      setReason("");
      await onUpdated();
      showToast(status === "verified" ? "Payment verified." : "Payment proof rejected.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The payment review could not be saved.", "error");
    } finally {
      setActiveId(null);
    }
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    const action = pendingAction;
    const reviewer = reviewerName.trim();
    if (action.kind !== "recordBalance" && !reviewer) return;
    setPendingAction(null);
    setReviewerName("");
    if (action.kind === "verify" && reviewer) await saveReview(action.payment, "verified", reviewer);
    else if (action.kind === "reject" && reviewer) await saveReview(action.payment, "rejected", reviewer);
    else await saveInPersonPayment();
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
              <span>AMOUNT PAID</span>
              <strong>{money(amountPaid)}</strong>
            </div>
            <div>
              <span>REMAINING BALANCE</span>
              <strong>{money(balanceDue)}</strong>
              <small>
                Customer preference: {booking.balancePaymentPreference === "in_person" ? "Pay in person" : "Online GCash"}
              </small>
            </div>
            <span className={styles.balanceDue}>Due before handover</span>
          </div>

          <div className={styles.optionsGrid}>
            <details className={`${styles.optionCard} ${styles.collectionPanel}`} open={booking.balancePaymentPreference === "in_person"}>
              <summary className={styles.optionSummary}>
                <span className={styles.optionTitle}>Record Remaining Balance</span>
                <span className={styles.optionDesc}>Record cash or GCash collected face-to-face and clear the balance right away.</span>
              </summary>
              <div className={styles.collectionForm}>
                <label>
                  <span>Payment received through</span>
                  <select value={recordMethod} onChange={(event) => setRecordMethod(event.target.value as "cash" | "gcash_in_person")} disabled={recording}>
                    <option value="cash">Cash</option>
                    <option value="gcash_in_person">GCash shown/paid in person</option>
                  </select>
                </label>
                <label>
                  <span>Reference number (if applicable)</span>
                  <input value={recordReference} onChange={(event) => setRecordReference(event.target.value)} maxLength={120} disabled={recording} />
                </label>
                <label className={styles.fullField}>
                  <span>Note (optional)</span>
                  <textarea value={recordNotes} onChange={(event) => setRecordNotes(event.target.value)} rows={2} maxLength={1000} disabled={recording} placeholder="Who received it, where, or any useful handover note" />
                </label>
                <Button
                  variant="none"
                  type="button"
                  className={styles.recordButton}
                  onClick={() => setPendingAction({ kind: "recordBalance" })}
                  disabled={recording || needsReview.length > 0}
                >
                  {recording ? "Recording…" : `Record ${money(balanceDue)} as paid`}
                </Button>
                {needsReview.length > 0 ? <small className={styles.collectionWarning}>Review the pending online proof before recording another payment.</small> : null}
              </div>
            </details>
          </div>
        </div>
      ) : (
        <p className={styles.fullyPaid}>✓ Fully paid — handover payment requirement complete.</p>
      )}

      <div className={styles.list}>
        {payments.length === 0 ? <p className={styles.empty}>No payment submissions yet.</p> : null}
        {[...needsReview, ...reviewed].map((payment) => {
          const isSaving = activeId === payment.id;
          const metadata = payment.providerMetadata as { accountName?: string; accountNumber?: string };
          const actionable = payment.status === "submitted" || payment.status === "under_review";
          return (
            <article key={payment.id} className={`${styles.card} ${styles[payment.status] ?? ""}`}>
              <div className={styles.topline}>
                <div className={styles.summary}>
                  <strong>{money(payment.amount)}</strong>
                  <span>{stageLabel(payment.stage)} · {payment.paymentMethod?.toUpperCase() || "MANUAL"}</span>
                </div>
                <span className={`${styles.statusPill} ${styles[payment.status] ?? ""}`}>{formatStage(payment.status)}</span>
              </div>

              <dl className={styles.facts}>
                <div><dt>Reference Number</dt><dd>{payment.externalReference || "-"}</dd></div>
                <div><dt>Paid From</dt><dd>{metadata.accountName || "-"}{metadata.accountNumber ? ` (${metadata.accountNumber})` : ""}</dd></div>
                <div><dt>Submitted Date &amp; Time</dt><dd>{formatDate(payment.submittedAt)}</dd></div>
              </dl>

              {payment.status === "verified" ? (
                <dl className={styles.reviewInfo}>
                  <div><dt>Approved By</dt><dd>{payment.reviewerName || payment.reviewedByName || "Admin"}</dd></div>
                  <div><dt>Approved Date &amp; Time</dt><dd>{formatDate(payment.reviewedAt)}</dd></div>
                </dl>
              ) : payment.status === "rejected" ? (
                <dl className={styles.reviewInfo}>
                  <div><dt>Rejected By</dt><dd>{payment.reviewerName || payment.reviewedByName || "Admin"}</dd></div>
                  <div><dt>Rejection Reason</dt><dd>{payment.reviewNotes || "-"}</dd></div>
                  <div><dt>Rejected Date &amp; Time</dt><dd>{formatDate(payment.reviewedAt)}</dd></div>
                </dl>
              ) : null}

              <div className={styles.actions}>
                {payment.proofStoragePath ? (
                  <Button variant="none" type="button" className={styles.openButton} onClick={() => onOpenProof(payment)} disabled={activeId !== null}>
                    Open proof
                  </Button>
                ) : null}
                {actionable ? (
                  <>
                    <Button variant="none"
                      type="button"
                      className={styles.approveButton}
                      onClick={() => { setPendingAction({ kind: "verify", payment }); setReviewerName(""); }}
                      disabled={activeId !== null}
                    >
                      {isSaving ? "Saving..." : "Verify payment"}
                    </Button>
                    <Button variant="none"
                      type="button"
                      className={styles.rejectButton}
                      onClick={() => { setPendingAction({ kind: "reject", payment }); setReason(""); setReviewerName(""); }}
                      disabled={activeId !== null}
                    >
                      Reject
                    </Button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {pendingAction ? (
        <ConfirmModal
          title={
            pendingAction.kind === "verify"
              ? "Verify Payment"
              : pendingAction.kind === "reject"
              ? "Reject Payment"
              : "Record Balance Payment"
          }
          description={
            pendingAction.kind === "verify"
              ? "Are you sure you want to verify this payment?"
              : pendingAction.kind === "reject"
              ? "Are you sure you want to reject this payment?"
              : "Is this payment information final?"
          }
          confirmLabel="Confirm"
          tone={pendingAction.kind === "reject" ? "danger" : "default"}
          onCancel={() => { setPendingAction(null); setReviewerName(""); setReason(""); }}
          onConfirm={() => void confirmPendingAction()}
          confirmDisabled={
            pendingAction.kind === "recordBalance"
              ? false
              : !reviewerName.trim() || (pendingAction.kind === "reject" && !reason.trim())
          }
        >
          {pendingAction.kind === "reject" ? (
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
          ) : null}
          {pendingAction.kind !== "recordBalance" ? (
            <label>
              <span>{pendingAction.kind === "verify" ? "Approved by" : "Rejected by"}</span>
              <input
                type="text"
                value={reviewerName}
                onChange={(event) => setReviewerName(event.target.value)}
                maxLength={120}
                placeholder="Enter the reviewer's full name"
                required
              />
            </label>
          ) : null}
        </ConfirmModal>
      ) : null}
    </section>
  );
}
