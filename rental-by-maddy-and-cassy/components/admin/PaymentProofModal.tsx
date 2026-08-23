"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { createClient } from "@/src/lib/supabase/client";
import { getBookingFileUrl } from "@/src/services/bookingDetailService";
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

export default function PaymentProofModal({
  payment,
  onClose,
}: {
  payment: PaymentWithProof;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      </div>
    </Modal>
  );
}
