"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import {
  detectFileKind,
  loadBookingFileBlob,
  saveBlobAs,
  type BookingFileKind,
  type BookingFileTarget,
} from "@/src/lib/bookingFiles";
import styles from "./BookingFilePreview.module.css";

type PreviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; blob: Blob; url: string; kind: BookingFileKind };

/**
 * Shows a booking file inside the page. Opening a file never downloads it;
 * the admin saves a copy only by choosing the separate Download button.
 */
export default function BookingFilePreview({
  target,
  onClose,
}: {
  target: BookingFileTarget;
  onClose: () => void;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    loadBookingFileBlob(target)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({
          status: "ready",
          blob,
          url: objectUrl,
          kind: detectFileKind(target.fileName, target.mimeType),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target, attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  return (
    <Modal title={target.title} onClose={onClose} size="wide">
      <div className={styles.toolbar}>
        <span className={styles.fileName}>{target.fileName}</span>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={state.status !== "ready"}
          onClick={() => {
            if (state.status === "ready") saveBlobAs(state.blob, target.fileName);
          }}
        >
          Download
        </Button>
      </div>

      <div className={styles.viewer}>
        {state.status === "loading" ? (
          <div className={styles.message}>
            <Spinner size={28} label="Opening file" />
            <p>Opening file…</p>
          </div>
        ) : state.status === "error" ? (
          <div className={styles.message} role="alert">
            <p>This file could not be opened. Please try again.</p>
            <Button variant="secondary" size="sm" type="button" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : state.kind === "pdf" ? (
          <iframe className={styles.frame} src={state.url} title={target.title} />
        ) : state.kind === "image" ? (
          // A blob URL of a private file, so next/image has nothing to optimize here.
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.image} src={state.url} alt={target.title} />
        ) : (
          <div className={styles.message}>
            <p>A preview is not available for this type of file. Use Download to save a copy.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
