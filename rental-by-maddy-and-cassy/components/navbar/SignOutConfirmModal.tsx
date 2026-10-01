"use client";

import { useId } from "react";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import styles from "./SignOutConfirmModal.module.css";

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}

/**
 * Customer sign-out confirmation. Signing out ends the current session, so the
 * next sign-in goes through the normal email OTP verification again.
 */
export default function SignOutConfirmModal({ onConfirm, onCancel, busy = false, error }: Props) {
  const descriptionId = useId();

  function handleClose() {
    if (busy) return;
    onCancel();
  }

  return (
    <Modal title="Sign out" onClose={handleClose} describedBy={descriptionId}>
      <div className={styles.body}>
        <div id={descriptionId} className={styles.intro}>
          <span className={styles.icon} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </span>
          <div>
            <p className={styles.prompt}>Are you sure you want to sign out?</p>
            <p className={styles.description}>
              Signing out will end your current session on this device.
            </p>
          </div>
        </div>

        <p className={styles.note}>
          You&rsquo;ll need to verify your email with a new OTP code when you sign in again.
        </p>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          <Button variant="secondary" type="button" onClick={handleClose} disabled={busy}>
            Stay Signed In
          </Button>
          <Button
            variant="danger"
            type="button"
            loading={busy}
            loadingText="Signing out…"
            onClick={onConfirm}
          >
            Sign Out
          </Button>
        </div>
      </div>
    </Modal>
  );
}
