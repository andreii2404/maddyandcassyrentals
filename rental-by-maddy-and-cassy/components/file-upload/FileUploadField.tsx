"use client";

import { useEffect, useId, useState } from "react";
import formStyles from "@/components/ui/Form.module.css";
import { Button } from "@/components/ui/Button";
import styles from "./FileUploadField.module.css";

interface FileUploadFieldProps {
  id?: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
  accept?: string;
  maxSizeMb?: number;
  helpText?: string;
  /** Externally-driven message (e.g. "this file is required") shown while no file is selected. */
  errorMessage?: string | null;
  value: File | null;
  onChange: (file: File | null) => void;
}

const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export default function FileUploadField({
  id,
  label,
  required = false,
  disabled = false,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = 8,
  helpText,
  errorMessage,
  value,
  onChange,
}: FileUploadFieldProps) {
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    const url = value?.type.startsWith("image/") ? URL.createObjectURL(value) : null;
    // Synchronize the browser-owned resource and release it on replacement/unmount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviewUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [value]);
  const requiredError = !value ? (errorMessage ?? null) : null;
  const displayError = error ?? requiredError;

  const acceptedTypes = accept.split(",").map((type) => type.trim());

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (disabled) return;
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) return;

    if (!acceptedTypes.includes(file.type)) {
      setError("Unsupported file type. Please upload a JPG, PNG, WEBP, or PDF file.");
      return;
    }

    if (file.size > maxSizeMb * 1024 * 1024) {
      setError(`File is too large. Maximum size is ${maxSizeMb}MB.`);
      return;
    }

    setError(null);
    onChange(file);
  }

  function handleRemove() {
    setError(null);
    onChange(null);
  }

  return (
    <div id={id} className={`${formStyles.field} ${styles.field}`} aria-disabled={disabled || undefined}>
      <label className={formStyles.label} htmlFor={inputId}>
        {label}
        {required ? <span className={formStyles.required}>*</span> : null}
      </label>

      {value ? (
        <div className={styles.preview}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={`${label} preview`}
              className={styles.previewImage}
            />
          ) : (
            <span className={styles.fileIcon} aria-hidden="true">
              📄
            </span>
          )}
          <div className={styles.previewInfo}>
            <p className={styles.fileName}>{value.name}</p>
            <p className={styles.fileMeta}>{(value.size / (1024 * 1024)).toFixed(2)} MB — Ready to upload</p>
          </div>
          <Button variant="none" className={styles.removeButton} onClick={handleRemove} disabled={disabled}>
            Remove
          </Button>
        </div>
      ) : (
        <label
          className={`${styles.dropzone} ${displayError ? styles.dropzoneError : ""}`}
          htmlFor={inputId}
        >
          <span className={styles.dropzoneText}>Click to choose a file</span>
          <span className={styles.dropzoneHint}>JPG, PNG, WEBP, or PDF · up to {maxSizeMb}MB</span>
        </label>
      )}

      <input
        id={inputId}
        type="file"
        disabled={disabled}
        aria-required={required}
        aria-invalid={Boolean(displayError)}
        aria-describedby={displayError ? `${inputId}-error` : helpText ? `${inputId}-help` : undefined}
        accept={accept}
        onChange={handleFileChange}
        className={styles.hiddenInput}
      />

      {helpText && !displayError ? <p id={`${inputId}-help`} className={formStyles.helpText}>{helpText}</p> : null}
      {displayError ? (
        <p id={`${inputId}-error`} className={formStyles.errorText} role="alert">
          {displayError}
        </p>
      ) : null}
    </div>
  );
}
