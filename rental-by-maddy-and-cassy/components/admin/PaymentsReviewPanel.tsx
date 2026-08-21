"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import { reviewManualPayment } from "@/src/services/paymentService";
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
  payments,
  onOpenProof,
  onUpdated,
}: {
  bookingId: string;
  payments: PaymentRecord[];
  onOpenProof(payment: PaymentRecord): void;
  onUpdated(): Promise<void>;
}) {
  const { showToast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const needsReview = payments.filter((p) => p.status === "submitted" || p.status === "under_review");
  const reviewed = payments.filter((p) => p.status !== "submitted" && p.status !== "under_review");

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

  if (payments.length === 0) {
    return <p className={styles.empty}>No payment submissions yet.</p>;
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

      <div className={styles.list}>
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
