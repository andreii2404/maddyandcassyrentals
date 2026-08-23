"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { GCASH_RECIPIENT } from "@/src/lib/gcashPayment";
import styles from "./GcashRecipientCard.module.css";

const GCASH_PAYMENT_TYPES = ["GCash", "GCash to GCash", "GCash to Bank"];

export default function GcashRecipientCard({
  instruction,
  compact = false,
}: {
  instruction?: ReactNode;
  compact?: boolean;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyMobileNumber() {
    try {
      await navigator.clipboard.writeText(GCASH_RECIPIENT.mobileNumber);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2200);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className={`${styles.card} ${compact ? styles.compact : ""}`}>
      <div className={styles.qrColumn}>
        <div className={styles.qrImageWrapper}>
          <Image
            src={GCASH_RECIPIENT.qrImagePath}
            alt={`GCash QR code for ${GCASH_RECIPIENT.accountName}`}
            fill
            sizes={compact ? "140px" : "180px"}
            quality={100}
            unoptimized
            priority={false}
          />
        </div>
        <span className={styles.qrHint}>Scan with your GCash app</span>
        <a
          className={styles.downloadButton}
          href={GCASH_RECIPIENT.qrImagePath}
          download={GCASH_RECIPIENT.qrDownloadFilename}
        >
          Download QR
        </a>
      </div>

      <div className={styles.details}>
        <div>
          <span className={styles.detailLabel}>Account name</span>
          <strong className={styles.accountValue}>{GCASH_RECIPIENT.accountName}</strong>
        </div>

        <div>
          <span className={styles.detailLabel}>Mobile number</span>
          <div className={styles.mobileRow}>
            <strong className={styles.accountValue}>{GCASH_RECIPIENT.mobileNumber}</strong>
            <button className={styles.copyButton} type="button" onClick={() => void copyMobileNumber()}>
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy number"}
            </button>
          </div>
          <span className={styles.copyStatus} aria-live="polite">
            {copyState === "copied"
              ? "GCash mobile number copied."
              : copyState === "failed"
                ? "Copy was blocked. Select the number above to copy it manually."
                : ""}
          </span>
        </div>

        {!compact ? (
          <div>
            <span className={styles.detailLabel}>Accepted payment options</span>
            <div className={styles.paymentTypes}>
              {GCASH_PAYMENT_TYPES.map((type) => (
                <span key={type} className={styles.paymentType}>{type}</span>
              ))}
            </div>
          </div>
        ) : null}

        {instruction ? <p className={styles.instruction}>{instruction}</p> : null}
      </div>
    </div>
  );
}
