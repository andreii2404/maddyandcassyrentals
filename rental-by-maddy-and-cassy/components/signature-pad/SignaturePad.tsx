"use client";

import { useEffect, useId, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import type { SignatureMethod } from "@/src/types/reservationDraft";
import { validateSavedSignatureFile } from "@/src/lib/savedSignature";
import { Button } from "@/components/ui/Button";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./SignaturePad.module.css";

interface SignaturePadProps {
  method: SignatureMethod;
  signatureDataUrl: string | null;
  onMethodChange: (method: SignatureMethod) => void;
  onSignatureChange: (dataUrl: string | null, file: File | null) => void;
  /** Makes the pad inert (no drawing, uploading or clearing). */
  disabled?: boolean;
  /** Id of the element that labels the drawing area. */
  labelledBy?: string;
  /** Replaces the default "required" hint shown while no signature exists. */
  helpText?: string;
  /** Drawn marks smaller than this (CSS px) are rejected as stray taps. 0 disables the check. */
  minDrawnSizePx?: number;
  /** Shows a "Signature captured" confirmation once a signature exists. */
  showStatus?: boolean;
}

export default function SignaturePad({
  method,
  signatureDataUrl,
  onMethodChange,
  onSignatureChange,
  disabled = false,
  labelledBy,
  helpText = "Your signature is required to continue.",
  minDrawnSizePx = 0,
  showStatus = false,
}: SignaturePadProps) {
  const canvasRef = useRef<SignatureCanvas>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onSignatureChangeRef = useRef(onSignatureChange);
  const inputId = useId();
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    onSignatureChangeRef.current = onSignatureChange;
  }, [onSignatureChange]);

  // The pad is inert while disabled; re-bind when the canvas is remounted.
  useEffect(() => {
    const pad = canvasRef.current;
    if (!pad || method !== "drawn") return;
    if (disabled) pad.off();
    else pad.on();
  }, [disabled, method]);

  // A parent that resets the signature to null (for example after a successful
  // submit) must also empty the canvas, or the old ink stays on screen.
  useEffect(() => {
    const pad = canvasRef.current;
    if (method === "drawn" && signatureDataUrl === null && pad && !pad.isEmpty()) {
      pad.clear();
    }
  }, [method, signatureDataUrl]);

  // Keep the canvas bitmap in step with its on-screen size. The bitmap must
  // match the CSS size or strokes land offset from the pointer, and a canvas
  // mounted while hidden (a closed tab, display:none) measures 0px wide and
  // would stay unusable. Observing the element sizes it as soon as it is shown.
  useEffect(() => {
    if (method !== "drawn") return;
    const pad = canvasRef.current;
    if (!pad) return;
    const canvas = pad.getCanvas();

    function syncCanvasSize() {
      const current = canvasRef.current;
      if (!current) return;
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      if (width === 0 || height === 0) return;

      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const targetWidth = Math.floor(width * ratio);
      const targetHeight = Math.floor(height * ratio);
      if (canvas.width === targetWidth && canvas.height === targetHeight) return;

      // Resizing a canvas wipes it, so a signature drawn before the resize is
      // discarded and the parent is told, rather than leaving it with a stale one.
      const hadInk = !current.isEmpty();
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.getContext("2d")?.scale(ratio, ratio);
      current.clear();
      if (hadInk) {
        onSignatureChangeRef.current(null, null);
        setNotice("The signature area was resized, so the signature was cleared. Please sign again.");
      }
    }

    syncCanvasSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncCanvasSize);
      return () => window.removeEventListener("resize", syncCanvasSize);
    }
    const observer = new ResizeObserver(syncCanvasSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [method]);

  function handleBegin() {
    setNotice(null);
  }

  function handleEnd() {
    const canvas = canvasRef.current;
    if (!canvas || canvas.isEmpty()) {
      onSignatureChange(null, null);
      return;
    }
    const trimmed = canvas.getTrimmedCanvas();
    if (minDrawnSizePx > 0) {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      if (Math.max(trimmed.width, trimmed.height) / ratio < minDrawnSizePx) {
        canvas.clear();
        onSignatureChange(null, null);
        setNotice("That mark is too small to be a signature. Please sign again.");
        return;
      }
    }
    onSignatureChange(trimmed.toDataURL("image/png"), null);
  }

  function handleClear() {
    canvasRef.current?.clear();
    setFileError(null);
    setNotice(null);
    onSignatureChange(null, null);
  }

  function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const error = validateSavedSignatureFile(file);
    if (error) {
      setFileError(error);
      return;
    }
    setFileError(null);
    setNotice(null);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      onSignatureChange(dataUrl, dataUrl ? file : null);
    };
    reader.readAsDataURL(file);
  }

  function switchMethod(nextMethod: SignatureMethod) {
    setFileError(null);
    setNotice(null);
    onMethodChange(nextMethod);
    canvasRef.current?.clear();
  }

  function handleUploadClick() {
    if (disabled) return;
    if (method !== "uploaded") switchMethod("uploaded");
    fileInputRef.current?.click();
  }

  return (
    <div className={styles.wrapper}>
       <div className={styles.tabs} role="tablist" aria-label="Signature method">
         <Button
           variant="none"
           role="tab"
           aria-selected={method === "drawn"}
           className={`${styles.tab} ${method === "drawn" ? styles.tabActive : ""}`}
           onClick={() => switchMethod("drawn")}
           disabled={disabled}
         >
           Draw Signature
         </Button>
         <Button
           variant="none"
           role="tab"
           aria-selected={method === "uploaded"}
           className={`${styles.tab} ${method === "uploaded" ? styles.tabActive : ""}`}
           onClick={handleUploadClick}
           disabled={disabled}
         >
           Upload Signature Image
         </Button>
       </div>

      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleUpload}
        className={styles.hiddenInput}
        tabIndex={method === "uploaded" && !signatureDataUrl && !disabled ? 0 : -1}
        aria-label="Upload signature image"
        disabled={disabled}
      />

      {method === "drawn" ? (
        <div className={styles.canvasWrapper}>
          {/* Right-click and long-press menus would interrupt a stroke. */}
          <div
            className={`${styles.canvasFrame} ${disabled ? styles.canvasFrameDisabled : ""}`}
            onContextMenu={(event) => event.preventDefault()}
          >
            <SignatureCanvas
              ref={canvasRef}
              penColor="#242424"
              clearOnResize={false}
              canvasProps={{
                className: styles.canvas,
                "aria-labelledby": labelledBy,
                "aria-label": labelledBy ? undefined : "Draw your signature",
                "aria-disabled": disabled,
              }}
              onBegin={handleBegin}
              onEnd={handleEnd}
            />
          </div>
          <Button variant="none" className={styles.clearButton} onClick={handleClear} disabled={disabled}>
            Clear Signature
          </Button>
        </div>
      ) : (
        <div className={styles.uploadWrapper}>
          {signatureDataUrl ? (
            <div className={styles.uploadPreview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signatureDataUrl} alt="Uploaded signature preview" draggable={false} />
              <Button variant="none" className={styles.clearButton} onClick={handleUploadClick} disabled={disabled}>
                Replace Signature Image
              </Button>
              <Button variant="none" className={styles.clearButton} onClick={handleClear} disabled={disabled}>
                Clear Signature
              </Button>
            </div>
          ) : (
            <label
              className={`${styles.uploadDropzone} ${disabled ? styles.uploadDropzoneDisabled : ""}`}
              htmlFor={inputId}
            >
              <span>Click to upload a signature image</span>
            </label>
          )}
        </div>
      )}

      {showStatus && signatureDataUrl ? (
        <p className={styles.statusDone} role="status">✓ Signature captured</p>
      ) : null}
      {!signatureDataUrl ? (
        <p className={formStyles.helpText}>{helpText}</p>
      ) : null}
      {notice ? <p className={formStyles.helpText} role="status" aria-live="polite">{notice}</p> : null}
      {fileError ? <p className={formStyles.errorText} role="alert">{fileError}</p> : null}
    </div>
  );
}
