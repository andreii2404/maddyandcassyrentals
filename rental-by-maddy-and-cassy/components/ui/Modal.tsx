"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";
import { Button } from "@/components/ui/Button";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  describedBy?: string;
  /** "wide" suits document viewers, "medium" detail views that need a little more room, and "small" short single-field dialogs; every existing dialog keeps the default width. */
  size?: "default" | "medium" | "wide" | "small";
  /** Portals to <body> and keeps the dialog clear of the fixed navbar; the body scrolls so every corner clips to the same radius. */
  belowHeader?: boolean;
}

export default function Modal({ title, onClose, children, describedBy, size = "default", belowHeader = false }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => element.getClientRects().length > 0 && element.tabIndex >= 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first) {
        event.preventDefault();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const dialogClassName =
    size === "wide"
      ? `${styles.dialog} ${styles.dialogWide}`
      : size === "medium"
        ? `${styles.dialog} ${styles.dialogMedium}`
        : size === "small"
          ? `${styles.dialog} ${styles.dialogSmall}`
          : styles.dialog;

  const modal = (
    <div className={belowHeader ? `${styles.overlay} ${styles.overlayBelowHeader}` : styles.overlay} onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={belowHeader ? `${dialogClassName} ${styles.dialogContained}` : dialogClassName}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={describedBy}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <Button
            variant="none"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </Button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );

  // A parent stacking context (e.g. the hero's z-index: 1) would otherwise trap the overlay beneath the navbar.
  return belowHeader && typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
}
