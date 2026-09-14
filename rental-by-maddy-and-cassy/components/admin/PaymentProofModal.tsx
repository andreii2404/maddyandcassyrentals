"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/ToastProvider";
import { createClient } from "@/src/lib/supabase/client";
import { getBookingFileUrl } from "@/src/services/bookingDetailService";
import { reviewManualPayment } from "@/src/services/paymentService";
import type { StorageBucket } from "@/src/lib/supabase/storage";
import type { AdminPaymentRecord } from "@/src/types/payment";
import GuestBadge from "@/components/status-badge/GuestBadge";
import styles from "./PaymentProofModal.module.css";

export type PaymentWithProof = AdminPaymentRecord & {
  proofStorageBucket: string;
  proofStoragePath: string;
};

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-PH");
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isPdfProof(payment: PaymentWithProof): boolean {
  const name = payment.proofOriginalFilename ?? payment.proofStoragePath;
  return name.toLowerCase().endsWith(".pdf");
}

/** Maps the payment_submission_status enum to the Pending/Approved/Rejected label this modal shows. */
function reviewStatusLabel(status: PaymentWithProof["status"]): string {
  if (status === "verified") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "void") return "Void";
  return "Pending";
}

export default function PaymentProofModal({
  payment,
  onClose,
  onReviewed,
}: {
  payment: PaymentWithProof;
  onClose: () => void;
  /** Called after Approve/Reject saves successfully, so the caller can refresh the payment list/record. */
  onReviewed?: () => void | Promise<void>;
}) {
  const { showToast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRejecting, setIsRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    getBookingFileUrl(supabase, payment.proofStorageBucket as StorageBucket, payment.proofStoragePath)
      .then((signedUrl) => {
        if (active) setUrl(signedUrl);
      })
      .catch(() => {
        if (active) setError("This payment proof could not be opened.");
      });

    return () => {
      active = false;
    };
  }, [payment]);

  const actionable = payment.status === "submitted" || payment.status === "under_review";

  async function handleReview(status: "verified" | "rejected") {
    if (saving) return;
    const rejectionReason = status === "rejected" ? reason.trim() : "";
    if (status === "rejected" && !rejectionReason) {
      setReviewError("Add a reason for the rejection.");
      return;
    }
    setSaving(true);
    setReviewError(null);
    try {
      await reviewManualPayment(payment.bookingId, payment.id, status, rejectionReason || undefined);
      setReason("");
      setIsRejecting(false);
      await onReviewed?.();
      showToast(status === "verified" ? "Payment approved." : "Payment proof rejected.", "success");
    } catch (reviewException) {
      const message =
        reviewException instanceof Error ? reviewException.message : "The payment review could not be saved.";
      setReviewError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Payment Proof" onClose={onClose}>
      <div className={styles.layout}>
        <div className={styles.preview}>
          {error ? (
            <p className={styles.previewMessage}>{error}</p>
          ) : !url ? (
            <Spinner size={24} label="Loading proof" />
          ) : isPdfProof(payment) ? (
            <div className={styles.previewMessage}>
              <p>This proof was submitted as a PDF.</p>
              <a href={url} target="_blank" rel="noopener noreferrer" className={styles.openPdfLink}>
                Open PDF in new tab ↗
              </a>
            </div>
          ) : (
            // Private signed URLs must load directly, without the public image optimizer/cache.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Submitted GCash payment proof" className={styles.previewImage} />
          )}
        </div>
        <dl className={styles.details}>
          <div>
            <dt>Customer</dt>
            <dd className={styles.customerNameRow}>
              {payment.customerName}
              {payment.isGuestCheckout ? <GuestBadge /> : null}
            </dd>
          </div>
          <div>
            <dt>Account Type</dt>
            <dd>{payment.isGuestCheckout ? "Guest" : "With Account"}</dd>
          </div>
          <div>
            <dt>Booking</dt>
            <dd>{payment.bookingRef}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>{money(payment.amount)}</dd>
          </div>
          <div>
            <dt>GCash Reference Number</dt>
            <dd>{payment.externalReference || "—"}</dd>
          </div>
          <div>
            <dt>Payment Status</dt>
            <dd>
              <span className={`${styles.pill} ${styles[payment.status] ?? ""}`}>
                {formatLabel(payment.status)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Submitted Date</dt>
            <dd>{formatDate(payment.submittedAt)}</dd>
          </div>
        </dl>

        <div className={styles.reviewSection}>
          <div className={styles.reviewHeader}>
            <span>Review Status</span>
            <span className={`${styles.pill} ${styles[payment.status] ?? ""}`}>
              {reviewStatusLabel(payment.status)}
            </span>
          </div>

          {payment.status === "verified" ? (
            <dl className={styles.reviewDetails}>
              <div>
                <dt>Approved By</dt>
                <dd>{payment.reviewedByName || "Admin"}</dd>
              </div>
              <div>
                <dt>Approved Date &amp; Time</dt>
                <dd>{payment.reviewedAt ? formatDate(payment.reviewedAt) : "—"}</dd>
              </div>
            </dl>
          ) : payment.status === "rejected" ? (
            <dl className={styles.reviewDetails}>
              <div>
                <dt>Rejected By</dt>
                <dd>{payment.reviewedByName || "Admin"}</dd>
              </div>
              <div>
                <dt>Rejection Reason</dt>
                <dd>{payment.reviewNotes || "—"}</dd>
              </div>
              <div>
                <dt>Rejected Date &amp; Time</dt>
                <dd>{payment.reviewedAt ? formatDate(payment.reviewedAt) : "—"}</dd>
              </div>
            </dl>
          ) : actionable ? (
            <div className={styles.reviewActions}>
              {!isRejecting ? (
                <>
                  <Button
                    variant="none"
                    type="button"
                    className={styles.approveButton}
                    onClick={() => void handleReview("verified")}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Approve"}
                  </Button>
                  <Button
                    variant="none"
                    type="button"
                    className={styles.rejectButton}
                    onClick={() => {
                      setIsRejecting(true);
                      setReason("");
                      setReviewError(null);
                    }}
                    disabled={saving}
                  >
                    Reject
                  </Button>
                </>
              ) : (
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
                    <Button
                      variant="none"
                      type="button"
                      className={styles.cancelButton}
                      onClick={() => {
                        setIsRejecting(false);
                        setReason("");
                        setReviewError(null);
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="none"
                      type="button"
                      className={styles.sendButton}
                      onClick={() => void handleReview("rejected")}
                      disabled={saving || !reason.trim()}
                    >
                      {saving ? "Sending…" : "Send rejection"}
                    </Button>
                  </div>
                </div>
              )}
              {reviewError ? <p className={styles.reviewError}>{reviewError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
