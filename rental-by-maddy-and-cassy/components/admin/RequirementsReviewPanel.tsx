"use client";

import { Button } from "@/components/ui/Button";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import Spinner from "@/components/ui/Spinner";
import ConfirmModal from "@/components/ui/ConfirmModal";
import Modal from "@/components/ui/Modal";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import {
  adminRequirementReviewLabel,
  RESUBMISSION_REQUESTED_MESSAGE,
  WAITING_FOR_RESUBMISSION_LABEL,
} from "@/src/lib/requirementResubmission";
import type { BookingDocument, BookingDocumentAttempt, RequirementReviewStatus, RequirementsStatus } from "@/src/types/booking";
import styles from "./RequirementsReviewPanel.module.css";

function formatDocumentType(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function RequirementsReviewPanel({
  bookingId,
  documents,
  onOpenDocument,
  onReviewed,
}: {
  bookingId: string;
  documents: BookingDocument[];
  onOpenDocument(document: BookingDocument): Promise<void>;
  onReviewed(
    documentId: string,
    patch: { reviewStatus: Exclude<RequirementReviewStatus, "pending">; reviewNotes?: string; reviewedAt?: string },
    requirementsStatus: RequirementsStatus,
  ): void;
}) {
  const { showToast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<"approved" | "rejected" | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  // Document id awaiting the admin's confirmation of a resubmission request.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showRequestedNotice, setShowRequestedNotice] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const reviewedCount = documents.filter((document) => document.reviewStatus !== "pending").length;
  const approvedCount = documents.filter((document) => document.reviewStatus === "approved").length;
  const resubmittedCount = documents.filter((document) => document.isResubmitted && document.reviewStatus === "pending").length;
  const waitingCount = documents.filter((document) => document.reviewStatus === "rejected").length;
  const progress = documents.length ? Math.round((reviewedCount / documents.length) * 100) : 0;
  // Waiting-for-resubmission documents cannot be approved until the customer uploads a replacement.
  const selectableIds = documents
    .filter((document) => document.reviewStatus === "pending")
    .map((document) => document.id);
  const confirmingDocument = documents.find((document) => document.id === confirmingId) ?? null;
  const selectedCount = selectableIds.filter((id) => selectedIds.has(id)).length;
  const allSelectableSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
  const someSelectableSelected = selectedCount > 0 && !allSelectableSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelectableSelected;
    }
  }, [someSelectableSelected]);

  async function handleOpen(document: BookingDocument) {
    setOpeningId(document.id);
    try {
      await onOpenDocument(document);
    } finally {
      setOpeningId(null);
    }
  }

  async function postReview(
    documentId: string,
    status: Exclude<RequirementReviewStatus, "pending">,
    rejectionReason: string,
  ): Promise<RequirementsStatus> {
    const response = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/requirements`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId, status, reason: rejectionReason }),
    });
    const body = (await response.json().catch(() => null)) as
      | { error?: unknown; requirementsStatus?: unknown }
      | null;
    if (!response.ok) {
      throw new Error(typeof body?.error === "string" ? body.error : "The review could not be saved.");
    }
    return (typeof body?.requirementsStatus === "string" ? body.requirementsStatus : "pending_review") as RequirementsStatus;
  }

  async function saveReview(
    documentId: string,
    status: Exclude<RequirementReviewStatus, "pending">,
  ) {
    const rejectionReason = status === "rejected" ? reason.trim() : "";
    if (status === "rejected" && !rejectionReason) {
      showToast("Explain what the customer needs to correct before sending the request.", "warning");
      return;
    }

    setActiveId(documentId);
    setActiveAction(status);
    try {
      const requirementsStatus = await postReview(documentId, status, rejectionReason);
      setReason("");
      setRejectingId(null);
      onReviewed(
        documentId,
        {
          reviewStatus: status,
          reviewNotes: rejectionReason || undefined,
          reviewedAt: new Date().toISOString(),
        },
        requirementsStatus,
      );
      if (status === "approved") {
        showToast("Document approved.", "success");
      } else {
        setShowRequestedNotice(true);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The review could not be saved.", "error");
    } finally {
      setActiveId(null);
      setActiveAction(null);
      setConfirmingId(null);
    }
  }

  function requestResubmissionConfirmation(documentId: string) {
    if (!reason.trim()) {
      showToast("Explain what the customer needs to correct before sending the request.", "warning");
      return;
    }
    setConfirmingId(documentId);
  }

  function toggleDocument(documentId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) => {
      if (selectableIds.length > 0 && selectableIds.every((id) => current.has(id))) {
        return new Set();
      }
      return new Set(selectableIds);
    });
  }

  async function handleApproveSelected() {
    const targets = selectableIds.filter((id) => selectedIds.has(id));
    if (targets.length === 0) {
      return;
    }

    setBulkApproving(true);
    const failed: string[] = [];
    let approved = 0;
    try {
      for (const documentId of targets) {
        try {
          const requirementsStatus = await postReview(documentId, "approved", "");
          onReviewed(documentId, { reviewStatus: "approved" }, requirementsStatus);
          approved += 1;
        } catch {
          failed.push(documentId);
        }
      }
    } finally {
      setBulkApproving(false);
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of targets) {
          if (!failed.includes(id)) {
            next.delete(id);
          }
        }
        return next;
      });
    }

    if (approved === 0) {
      showToast("The selected documents could not be approved.", "error");
    } else if (failed.length === 0) {
      showToast(`Approved ${approved} document${approved === 1 ? "" : "s"}.`, "success");
    } else {
      showToast(
        `Approved ${approved} document${approved === 1 ? "" : "s"}. ${failed.length} could not be approved.`,
        "error",
      );
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

      {resubmittedCount > 0 ? (
        <div className={styles.resubmissionAlert} role="alert">
          <strong>{resubmittedCount} document{resubmittedCount === 1 ? " has" : "s have"} been resubmitted.</strong>
          <span>Review the highlighted latest upload below. The previously rejected file is kept in history and is not the active review target.</span>
        </div>
      ) : null}

      {waitingCount > 0 ? (
        <div className={styles.waitingAlert} role="status">
          <strong>{waitingCount} requirement{waitingCount === 1 ? " is" : "s are"} {WAITING_FOR_RESUBMISSION_LABEL.toLowerCase()}.</strong>
          <span>The customer has been notified. This booking cannot be fully verified until each updated file is submitted and approved.</span>
        </div>
      ) : null}

      {selectableIds.length > 0 ? (
        <div className={styles.bulkBar}>
          <label className={styles.bulkCheckbox}>
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelectableSelected}
              onChange={toggleSelectAll}
              disabled={bulkApproving}
            />
            <span>Select all ({selectedCount}/{selectableIds.length})</span>
          </label>
          <Button variant="none"
            type="button"
            className={styles.bulkApproveButton}
            onClick={handleApproveSelected}
            disabled={bulkApproving || selectedCount === 0}
            aria-busy={bulkApproving}
          >
            {bulkApproving ? (
              <><Spinner size={11} label="Approving selected documents" /> Approving...</>
            ) : (
              `Approve Selected${selectedCount > 0 ? ` (${selectedCount})` : ""}`
            )}
          </Button>
        </div>
      ) : null}

      <div className={styles.list}>
        {documents.map((document, index) => {
          const isSaving = activeId === document.id;
          const isApproving = isSaving && activeAction === "approved";
          const isRejectingSave = isSaving && activeAction === "rejected";
          const isOpening = openingId === document.id;
          const isRejecting = rejectingId === document.id;
          const isApproved = document.reviewStatus === "approved";
          const isWaiting = document.reviewStatus === "rejected";
          const isResubmitted = document.isResubmitted && document.reviewStatus === "pending";
          const earlierAttempts = (document.history ?? []).filter((attempt) => attempt.id !== document.id);
          return (
            <article key={document.id} className={`${styles.documentCard} ${styles[document.reviewStatus]} ${isResubmitted ? styles.resubmitted : ""}`}>
              <div className={styles.documentTopline}>
                <div className={styles.toplineMain}>
                  <input
                    type="checkbox"
                    className={styles.cardCheckbox}
                    checked={selectedIds.has(document.id)}
                    onChange={() => toggleDocument(document.id)}
                    disabled={isApproved || isWaiting || bulkApproving}
                    aria-label={
                      isApproved
                        ? `${formatDocumentType(document.documentType)} already approved`
                        : isWaiting
                          ? `${formatDocumentType(document.documentType)} is waiting for resubmission`
                          : `Select ${formatDocumentType(document.documentType)} for approval`
                    }
                  />
                  <Button variant="none"
                    type="button"
                    className={styles.fileButton}
                    onClick={() => handleOpen(document)}
                    disabled={isOpening}
                    aria-busy={isOpening}
                  >
                    <span className={styles.fileIcon} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.fileInfo}>
                      <strong>{formatDocumentType(document.documentType)}</strong>
                      <small>{isOpening ? "Opening..." : (document.originalFilename || "Open secure customer file")}</small>
                    </span>
                  </Button>
                </div>
                <span className={`${styles.statusPill} ${styles[isResubmitted ? "resubmitted" : document.reviewStatus]}`}>
                  {adminRequirementReviewLabel(document.reviewStatus)}
                </span>
              </div>

              {isResubmitted ? (
                <div className={styles.resubmissionMeta} aria-label={`Resubmitted ${formatManilaDateTime(document.submittedAt)}`}>
                  <strong>Resubmitted – Needs Review</strong>
                  <span>{formatManilaDateTime(document.submittedAt)}</span>
                </div>
              ) : null}

              {isWaiting ? (
                <div className={styles.waitingMeta}>
                  <strong>{WAITING_FOR_RESUBMISSION_LABEL}</strong>
                  <span>{document.reviewedAt ? `Requested ${formatManilaDateTime(document.reviewedAt)}` : "Requested"}</span>
                </div>
              ) : null}

              {document.reviewNotes ? (
                <div className={styles.previousNote}>
                  <strong>{isWaiting ? "Resubmission reason sent to customer" : "Customer correction note"}</strong>
                  <p>{document.reviewNotes}</p>
                </div>
              ) : null}

              <div className={styles.actions}>
                <Button variant="none"
                  type="button"
                  className={styles.openButton}
                  onClick={() => handleOpen(document)}
                  disabled={isOpening}
                  aria-busy={isOpening}
                >
                  {isOpening ? <><Spinner size={11} label="Opening file" /> Opening...</> : "Open file"}
                </Button>
                <Button variant="none"
                  type="button"
                  className={styles.approveButton}
                  onClick={() => saveReview(document.id, "approved")}
                  disabled={isSaving || bulkApproving || isApproved || isWaiting}
                  aria-busy={isApproving}
                  title={isWaiting ? "Wait for the customer to submit the updated requirement." : undefined}
                >
                  {isApproving ? <><Spinner size={11} label="Saving approval" /> Saving...</> : isApproved ? "Approved" : isWaiting ? "Awaiting customer" : "Approve document"}
                </Button>
                <Button variant="none"
                  type="button"
                  className={styles.rejectButton}
                  onClick={() => openCorrectionEditor(document)}
                  disabled={isSaving || bulkApproving}
                >
                  {isWaiting ? "Edit resubmission request" : "Request Resubmission"}
                </Button>
              </div>

              {isRejecting ? (
                <div className={styles.rejectEditor}>
                  <label>
                    <span>Why does the customer need to resubmit this requirement?</span>
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
                    <Button variant="none"
                      type="button"
                      onClick={() => { setRejectingId(null); setReason(""); }}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button variant="none"
                      type="button"
                      className={styles.sendButton}
                      onClick={() => requestResubmissionConfirmation(document.id)}
                      disabled={isSaving || !reason.trim()}
                      aria-busy={isRejectingSave}
                    >
                      {isRejectingSave ? <><Spinner size={11} label="Sending resubmission request" /> Sending...</> : "Request Resubmission"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {earlierAttempts.length > 0 || isWaiting ? (
                <details className={styles.history}>
                  <summary>Submission history ({earlierAttempts.length + 1} upload{earlierAttempts.length === 0 ? "" : "s"})</summary>
                  <ol>
                    {earlierAttempts.map((attempt) => (
                      <AttemptHistoryItem
                        key={attempt.id}
                        attempt={attempt}
                        onOpen={() => void onOpenDocument({
                          ...document,
                          id: attempt.id,
                          storageBucket: attempt.storageBucket,
                          storagePath: attempt.storagePath,
                          originalFilename: attempt.originalFilename,
                        })}
                      />
                    ))}
                    <AttemptHistoryItem
                      attempt={{
                        id: document.id,
                        attemptNumber: document.attemptNumber,
                        submittedAt: document.submittedAt,
                        reviewStatus: document.reviewStatus,
                        reviewNotes: document.reviewNotes,
                        reviewedAt: document.reviewedAt,
                        storageBucket: document.storageBucket,
                        storagePath: document.storagePath,
                        originalFilename: document.originalFilename,
                      }}
                      isCurrent
                      onOpen={() => void handleOpen(document)}
                    />
                  </ol>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>

      {confirmingDocument ? (
        <ConfirmModal
          title="Request resubmission?"
          description={
            <>
              The customer will be notified to resubmit their <strong>{formatDocumentType(confirmingDocument.documentType)}</strong>.
              {" "}This requirement will be marked <strong>{WAITING_FOR_RESUBMISSION_LABEL}</strong> and the booking
              cannot be fully verified until the updated file is submitted and approved.
            </>
          }
          confirmLabel="Send request"
          busy={activeId === confirmingDocument.id}
          busyLabel="Sending..."
          tone="danger"
          onConfirm={() => void saveReview(confirmingDocument.id, "rejected")}
          onCancel={() => {
            if (activeId !== confirmingDocument.id) setConfirmingId(null);
          }}
        >
          <p className={styles.confirmReason}>
            <strong>Reason sent to the customer</strong>
            <span>{reason.trim()}</span>
          </p>
        </ConfirmModal>
      ) : null}

      {showRequestedNotice ? (
        <Modal title="Resubmission requested" onClose={() => setShowRequestedNotice(false)} describedBy="resubmission-requested-message">
          <div className={styles.noticeBody}>
            <p id="resubmission-requested-message">{RESUBMISSION_REQUESTED_MESSAGE}</p>
            <Button variant="primary" type="button" onClick={() => setShowRequestedNotice(false)}>
              OK
            </Button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function AttemptHistoryItem({
  attempt,
  isCurrent = false,
  onOpen,
}: {
  attempt: BookingDocumentAttempt;
  isCurrent?: boolean;
  onOpen(): void;
}) {
  return (
    <li className={styles.historyItem}>
      <div className={styles.historyHeader}>
        <strong>
          {attempt.attemptNumber > 1 ? `Resubmission ${attempt.attemptNumber - 1}` : "Original submission"}
          {isCurrent ? " (latest)" : ""}
        </strong>
        <Button variant="none" type="button" className={styles.historyOpen} onClick={onOpen} disabled={!attempt.storagePath}>
          Open file
        </Button>
      </div>
      <small>
        Submitted {formatManilaDateTime(attempt.submittedAt)}
        {attempt.originalFilename ? ` · ${attempt.originalFilename}` : ""}
      </small>
      {attempt.reviewStatus === "rejected" ? (
        <p className={styles.historyRequest}>
          Resubmission requested{attempt.reviewedAt ? ` ${formatManilaDateTime(attempt.reviewedAt)}` : ""}
          {attempt.reviewNotes ? `: ${attempt.reviewNotes}` : ""}
        </p>
      ) : attempt.reviewStatus === "approved" ? (
        <p className={styles.historyApproved}>
          Approved{attempt.reviewedAt ? ` ${formatManilaDateTime(attempt.reviewedAt)}` : ""}
        </p>
      ) : (
        <p className={styles.historyPending}>Needs review</p>
      )}
    </li>
  );
}
