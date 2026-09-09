"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/ToastProvider";
import Spinner from "@/components/ui/Spinner";
import type { BookingDocument, RequirementReviewStatus, RequirementsStatus } from "@/src/types/booking";
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
    patch: { reviewStatus: Exclude<RequirementReviewStatus, "pending">; reviewNotes?: string },
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
  const selectAllRef = useRef<HTMLInputElement>(null);
  const reviewedCount = documents.filter((document) => document.reviewStatus !== "pending").length;
  const approvedCount = documents.filter((document) => document.reviewStatus === "approved").length;
  const progress = documents.length ? Math.round((reviewedCount / documents.length) * 100) : 0;
  const selectableIds = documents
    .filter((document) => document.reviewStatus !== "approved")
    .map((document) => document.id);
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
      showToast("Explain what the customer needs to correct before sending the request.", "error");
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
        { reviewStatus: status, reviewNotes: rejectionReason || undefined },
        requirementsStatus,
      );
      showToast(
        status === "approved" ? "Document approved." : "Correction request sent to the customer.",
        "success",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The review could not be saved.", "error");
    } finally {
      setActiveId(null);
      setActiveAction(null);
    }
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
          <button
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
          </button>
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
          return (
            <article key={document.id} className={`${styles.documentCard} ${styles[document.reviewStatus]}`}>
              <div className={styles.documentTopline}>
                <div className={styles.toplineMain}>
                  <input
                    type="checkbox"
                    className={styles.cardCheckbox}
                    checked={selectedIds.has(document.id)}
                    onChange={() => toggleDocument(document.id)}
                    disabled={isApproved || bulkApproving}
                    aria-label={
                      isApproved
                        ? `${formatDocumentType(document.documentType)} already approved`
                        : `Select ${formatDocumentType(document.documentType)} for approval`
                    }
                  />
                  <button
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
                  </button>
                </div>
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
                  onClick={() => handleOpen(document)}
                  disabled={isOpening}
                  aria-busy={isOpening}
                >
                  {isOpening ? <><Spinner size={11} label="Opening file" /> Opening...</> : "Open file"}
                </button>
                <button
                  type="button"
                  className={styles.approveButton}
                  onClick={() => saveReview(document.id, "approved")}
                  disabled={isSaving || bulkApproving || document.reviewStatus === "approved"}
                  aria-busy={isApproving}
                >
                  {isApproving ? <><Spinner size={11} label="Saving approval" /> Saving...</> : document.reviewStatus === "approved" ? "Approved" : "Approve document"}
                </button>
                <button
                  type="button"
                  className={styles.rejectButton}
                  onClick={() => openCorrectionEditor(document)}
                  disabled={isSaving || bulkApproving}
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
                      aria-busy={isRejectingSave}
                    >
                      {isRejectingSave ? <><Spinner size={11} label="Sending correction request" /> Sending...</> : "Send correction request"}
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
