"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { createClient } from "@/src/lib/supabase/client";
import { getBookingFileUrl } from "@/src/services/bookingDetailService";
import { bookingHeadline } from "@/src/lib/bookingDisplay";
import type { StorageBucket } from "@/src/lib/supabase/storage";
import type { Booking } from "@/src/types/booking";
import type { PaymentRecord } from "@/src/types/payment";
import styles from "./PaymentDetailsModal.module.css";

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Shows the method actually stored on the submission rather than assuming GCash. */
function paymentMethodLabel(method: string | undefined): string {
  const normalized = method?.trim().toLowerCase();
  if (!normalized) return "Not specified";
  if (normalized === "gcash") return "GCash";
  if (normalized === "maya" || normalized === "paymaya") return "Maya";
  if (normalized === "bank" || normalized === "bank_transfer") return "Bank Transfer";
  return formatLabel(normalized);
}

function paymentTypeLabel(payment: PaymentRecord): string {
  if (payment.stage === "down_payment") return "Down Payment";
  if (payment.stage === "balance") return "Remaining Balance";
  return "Full Payment";
}

function senderName(payment: PaymentRecord): string | undefined {
  const value = payment.providerMetadata?.accountName;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPdfProof(payment: PaymentRecord): boolean {
  const name = payment.proofOriginalFilename ?? payment.proofStoragePath ?? "";
  return name.toLowerCase().endsWith(".pdf");
}

/**
 * Signed URLs are created with the signed-in customer's own session, so storage
 * RLS (owner folder / own booking) decides access — never the service role.
 */
async function loadProofUrl(payment: PaymentRecord): Promise<string | null> {
  if (payment.proofStorageBucket && payment.proofStoragePath) {
    return getBookingFileUrl(createClient(), payment.proofStorageBucket as StorageBucket, payment.proofStoragePath);
  }
  if (payment.proofDocumentId) {
    const response = await fetch(
      `/api/account/verification-documents/preview?documentId=${encodeURIComponent(payment.proofDocumentId)}`,
      { credentials: "same-origin", cache: "no-store" },
    );
    const body = (await response.json().catch(() => null)) as { url?: unknown } | null;
    if (!response.ok || typeof body?.url !== "string") throw new Error("Proof unavailable.");
    return body.url;
  }
  return null;
}

export default function PaymentDetailsModal({
  booking,
  payment,
  onClose,
}: {
  booking: Booking;
  payment: PaymentRecord;
  onClose: () => void;
}) {
  const hasProof = Boolean((payment.proofStorageBucket && payment.proofStoragePath) || payment.proofDocumentId);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState(false);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);
  const proofTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hasProof) return;
    let active = true;
    loadProofUrl(payment)
      .then((url) => {
        if (active) setProofUrl(url);
      })
      .catch(() => {
        if (active) setProofError("Your proof of payment could not be loaded right now.");
      });
    return () => {
      active = false;
    };
  }, [hasProof, payment]);

  useEffect(() => {
    if (!enlarged) return;
    lightboxCloseRef.current?.focus();
    const trigger = proofTriggerRef.current;
    // Capture phase so Escape closes only the enlarged view, not the details modal underneath.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setEnlarged(false);
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        lightboxCloseRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      trigger?.focus();
    };
  }, [enlarged]);

  const isDemo = Boolean((payment.providerMetadata as { demo?: boolean } | undefined)?.demo);
  const sender = senderName(payment);

  return (
    <Modal title="Payment Details" onClose={onClose} size="medium">
      <div className={styles.layout}>
        <div className={styles.summary}>
          <div>
            <span className={styles.eyebrow}>Amount Paid</span>
            <strong className={styles.amount}>{money(payment.amount)}</strong>
            {isDemo ? <span className={styles.demoNote}>Demo checkout preview — no charge</span> : null}
          </div>
          <span className={`${styles.pill} ${styles[payment.status] ?? ""}`}>{formatLabel(payment.status)}</span>
        </div>

        <dl className={styles.details}>
          <div>
            <dt>Booking Reference</dt>
            <dd>{booking.bookingRef}</dd>
          </div>
          <div>
            <dt>Item / Rental</dt>
            <dd>{bookingHeadline(booking.items)}</dd>
          </div>
          <div>
            <dt>Payment Type</dt>
            <dd>{paymentTypeLabel(payment)}</dd>
          </div>
          <div>
            <dt>Payment Method</dt>
            <dd>{paymentMethodLabel(payment.paymentMethod)}</dd>
          </div>
          <div>
            <dt>Account / Sender Name</dt>
            <dd>{sender ?? "—"}</dd>
          </div>
          <div>
            <dt>Reference Number</dt>
            <dd className={styles.mono}>{payment.externalReference || "—"}</dd>
          </div>
          <div>
            <dt>Date &amp; Time Submitted</dt>
            <dd>{new Date(payment.submittedAt || payment.createdAt).toLocaleString("en-PH")}</dd>
          </div>
          <div>
            <dt>Payment Status</dt>
            <dd>{formatLabel(payment.status)}</dd>
          </div>
        </dl>

        {payment.status === "rejected" && payment.reviewNotes ? (
          <p className={styles.rejection}>
            <strong>Reason:</strong> {payment.reviewNotes}
          </p>
        ) : null}

        <section className={styles.proofSection} aria-labelledby="payment-proof-heading">
          <h3 id="payment-proof-heading">Proof of Payment</h3>
          <div className={styles.preview}>
            {!hasProof ? (
              <p className={styles.previewMessage}>No proof of payment was uploaded for this record.</p>
            ) : proofError ? (
              <p className={styles.previewMessage}>{proofError}</p>
            ) : !proofUrl ? (
              <Spinner size={24} label="Loading proof of payment" />
            ) : isPdfProof(payment) ? (
              <div className={styles.previewMessage}>
                <p>Your proof was submitted as a PDF.</p>
                <a href={proofUrl} target="_blank" rel="noopener noreferrer" className={styles.openLink}>
                  Open PDF in new tab ↗
                </a>
              </div>
            ) : (
              <button
                ref={proofTriggerRef}
                type="button"
                className={styles.proofButton}
                onClick={() => setEnlarged(true)}
                aria-label="View proof of payment larger"
              >
                {/* Private signed URLs must load directly, without the public image optimizer/cache. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={proofUrl} alt="Your submitted proof of payment" className={styles.previewImage} />
                <span className={styles.zoomHint}>Click to enlarge</span>
              </button>
            )}
          </div>
        </section>
      </div>

      {enlarged && proofUrl ? (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label="Proof of payment, enlarged"
          onMouseDown={() => setEnlarged(false)}
        >
          <button
            ref={lightboxCloseRef}
            type="button"
            className={styles.lightboxClose}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => setEnlarged(false)}
            aria-label="Close enlarged proof"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proofUrl}
            alt="Your submitted proof of payment, enlarged"
            className={styles.lightboxImage}
            onMouseDown={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </Modal>
  );
}
