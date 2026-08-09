"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import type { BookingDocument, RequirementReviewStatus } from "@/src/types/booking";
import styles from "./RequirementsReviewPanel.module.css";

function formatDocumentType(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function RequirementsReviewPanel({
  bookingId,
  documents,
  onOpenDocument,
  onUpdated,
}: {
  bookingId: string;
  documents: BookingDocument[];
  onOpenDocument(document: BookingDocument): void;
  onUpdated(): Promise<void>;
}) {
  const { showToast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const reviewedCount = documents.filter((document) => document.reviewStatus !== "pending").length;
  const approvedCount = documents.filter((document) => document.reviewStatus === "approved").length;
  const progress = documents.length ? Math.round((reviewedCount / documents.length) * 100) : 0;

  async function saveReview(
    documentId: string,
    status: Exclude<RequirementReviewStatus, "pending">,
  ) {
    const rejectionReason = status === "rejected" ? reason.trim() : "";
    if (status === "rejected" && !rejectionReason) {
      showToast("Explain what the customer needs to correct before sending the request.", "error");
      return;
    }

    setActiveId(documentId);
    try {
      const response = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/requirements`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, status, reason: rejectionReason }),
      });
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : "The review could not be saved.");
      }
      setReason("");
      setRejectingId(null);
      await onUpdated();
      showToast(
        status === "approved" ? "Document approved." : "Correction request sent to the customer.",
        "success",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The review could not be saved.", "error");
    } finally {
      setActiveId(null);
    }
  }

  function openCorrectionEditor(document: BookingDocument) {
    setRejectingId(document.id);
    setReason(document.reviewNotes ?? "");
  }

  return (
    <section className={styles.panel} aria-labelledby="verification-review-heading">
      <div className={styles.panelHeader}>
        <div>
          <p>ADMIN REVIEW WORKSPACE</p>
          <h3 id="verification-review-heading">Verify each required document</h3>
          <span>Open the file, check that it is clear and valid, then record one decision.</span>
        </div>
        <div className={styles.reviewCount}>
          <strong>{approvedCount}/{documents.length}</strong>
          <span>approved</span>
        </div>
      </div>

      <div className={styles.progress} aria-label={`${progress}% of files reviewed`}>
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className={styles.list}>
        {documents.map((document, index) => {
          const isSaving = activeId === document.id;
          const isRejecting = rejectingId === document.id;
          return (
            <article key={document.id} className={`${styles.documentCard} ${styles[document.reviewStatus]}`}>
              <div className={styles.documentTopline}>
                <button
                  type="button"
                  className={styles.fileButton}
                  onClick={() => onOpenDocument(document)}
                  disabled={activeId !== null}
                >
                  <span className={styles.fileIcon} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.fileInfo}>
                    <strong>{formatDocumentType(document.documentType)}</strong>
                    <small>{document.originalFilename || "Open secure customer file"}</small>
                  </span>
                </button>
                <span className={`${styles.statusPill} ${styles[document.reviewStatus]}`}>
                  {document.reviewStatus === "pending" ? "Needs review" : formatDocumentType(document.reviewStatus)}
                </span>
              </div>

              {document.reviewNotes ? (
                <div className={styles.previousNote}>
                  <strong>Customer correction note</strong>
                  <p>{document.reviewNotes}</p>
                </div>
              ) : null}

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.openButton}
                  onClick={() => onOpenDocument(document)}
                  disabled={activeId !== null}
                >
                  Open file
                </button>
                <button
                  type="button"
                  className={styles.approveButton}
                  onClick={() => saveReview(document.id, "approved")}
                  disabled={activeId !== null || document.reviewStatus === "approved"}
                >
                  {isSaving ? "Saving..." : document.reviewStatus === "approved" ? "Approved" : "Approve document"}
                </button>
                <button
                  type="button"
                  className={styles.rejectButton}
                  onClick={() => openCorrectionEditor(document)}
                  disabled={activeId !== null}
                >
                  {document.reviewStatus === "rejected" ? "Edit correction" : "Request correction"}
                </button>
              </div>

              {isRejecting ? (
                <div className={styles.rejectEditor}>
                  <label>
                    <span>What exactly must the customer correct?</span>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Example: The ID photo is blurred. Upload a clear image showing all four corners and the expiry date."
                      autoFocus
                    />
                  </label>
                  <div>
                    <button
                      type="button"
                      onClick={() => { setRejectingId(null); setReason(""); }}
                      disabled={isSaving}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.sendButton}
                      onClick={() => saveReview(document.id, "rejected")}
                      disabled={isSaving || !reason.trim()}
                    >
                      {isSaving ? "Sending..." : "Send correction request"}
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
