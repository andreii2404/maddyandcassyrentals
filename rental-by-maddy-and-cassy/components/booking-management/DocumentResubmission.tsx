"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import type { BookingDocument } from "@/src/types/booking";
import styles from "./DocumentResubmission.module.css";

export default function DocumentResubmission({
  bookingId,
  document,
  onSubmitted,
}: {
  bookingId: string;
  document: BookingDocument;
  onSubmitted: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitReplacement() {
    if (!file || submitting) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(
        `/api/bookings/${encodeURIComponent(bookingId)}/documents/resubmit?submissionId=${encodeURIComponent(document.id)}`,
        { method: "POST", credentials: "same-origin", body: formData },
      );
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "The replacement could not be submitted.");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await onSubmitted();
      showToast("Replacement submitted for review.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The replacement could not be submitted.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <input
        ref={inputRef}
        className={styles.fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        disabled={submitting}
        aria-label={`Choose a replacement for ${document.documentType.replaceAll("_", " ")}`}
      />
      <Button variant="none" type="button" className={styles.chooseButton} onClick={() => inputRef.current?.click()} disabled={submitting}>
        Re-upload Document
      </Button>
      {file ? (
        <div className={styles.submitRow}>
          <span>{file.name}</span>
          <Button variant="primary" type="button" onClick={() => void submitReplacement()} loading={submitting} loadingText="Submitting...">
            Submit replacement
          </Button>
        </div>
      ) : null}
    </div>
  );
}