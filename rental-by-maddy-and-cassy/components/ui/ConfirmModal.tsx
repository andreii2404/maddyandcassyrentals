"use client";

import type { ReactNode } from "react";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import styles from "./ConfirmModal.module.css";

interface ConfirmModalProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  tone?: "default" | "danger";
  error?: ReactNode;
}

/**
 * Standard pop-up confirmation dialog for admin actions (delete, approve, reject,
 * cancel, status change, etc). Wraps the shared Modal so every confirmation in the
 * admin UI shares the same layout, spacing, and button styling.
 */
export default function ConfirmModal({
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  confirmDisabled = false,
  busy = false,
  busyLabel,
  tone = "default",
  error,
}: ConfirmModalProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      describedBy={description ? "confirm-modal-description" : undefined}
    >
      <div className={styles.body}>
        {description ? (
          <p id="confirm-modal-description" className={styles.description}>
            {description}
          </p>
        ) : null}
        {children ? <div className={styles.fields}>{children}</div> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.actions}>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled || busy}
          >
            {busy ? busyLabel || "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
