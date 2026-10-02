"use client";

import { useEffect, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/Button";
import styles from "./AdminSignaturePad.module.css";

interface AdminSignaturePadProps {
  /** PNG data URL of the captured signature, or null while the pad is empty. */
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  /** Id of the element that labels the drawing area. */
  labelledBy?: string;
}

/** A single tap leaves a dot, which is not a usable signature. */
const MIN_SIGNATURE_SIZE_PX = 24;

type PadMessage = { tone: "info" | "warning"; text: string } | null;

/**
 * Draw-only signature pad for the business countersignature. Unlike the
 * customer SignaturePad there is no upload option: the administrator must draw.
 */
export default function AdminSignaturePad({
  value,
  onChange,
  disabled = false,
  labelledBy,
}: AdminSignaturePadProps) {
  const padRef = useRef<SignatureCanvas>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const lastWidthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  const [hasInk, setHasInk] = useState(false);
  const [message, setMessage] = useState<PadMessage>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // The pad is inert while the countersignature is blocked or being submitted.
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    if (disabled) pad.off();
    else pad.on();
  }, [disabled]);

  // Keep the pad in step with the parent: a null value means "empty".
  useEffect(() => {
    const pad = padRef.current;
    if (value === null && pad && !pad.isEmpty()) {
      pad.clear();
      setHasInk(false);
    }
  }, [value]);

  // The canvas bitmap must match its on-screen size or strokes are offset, and a
  // resized bitmap is blank -- so a real width change discards the signature
  // instead of silently showing a stretched one. Height-only resizes (mobile
  // browser chrome showing/hiding while scrolling) are ignored.
  useEffect(() => {
    const pad = padRef.current;
    if (pad) lastWidthRef.current = pad.getCanvas().offsetWidth;

    function handleResize() {
      const current = padRef.current;
      if (!current) return;
      const canvas = current.getCanvas();
      const width = canvas.offsetWidth;
      if (width === 0 || width === lastWidthRef.current) return;
      lastWidthRef.current = width;

      const ratio = Math.max(window.devicePixelRatio ?? 1, 1);
      const hadSignature = !current.isEmpty();
      canvas.width = width * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext("2d")?.scale(ratio, ratio);
      current.clear();
      setHasInk(false);
      if (hadSignature) {
        onChangeRef.current(null);
        setMessage({ tone: "warning", text: "The signature area was resized, so the signature was cleared. Please sign again." });
      }
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handleBegin() {
    setHasInk(true);
    setMessage(null);
  }

  function handleEnd() {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      setHasInk(false);
      onChange(null);
      return;
    }
    const trimmed = pad.getTrimmedCanvas();
    const ratio = Math.max(window.devicePixelRatio ?? 1, 1);
    if (Math.max(trimmed.width, trimmed.height) / ratio < MIN_SIGNATURE_SIZE_PX) {
      pad.clear();
      setHasInk(false);
      onChange(null);
      setMessage({ tone: "warning", text: "That mark is too small to be a signature. Please sign again." });
      return;
    }
    onChange(trimmed.toDataURL("image/png"));
  }

  function handleClear() {
    padRef.current?.clear();
    setHasInk(false);
    setMessage({ tone: "info", text: "Signature cleared." });
    onChange(null);
  }

  function handleRedo() {
    padRef.current?.clear();
    setHasInk(false);
    setMessage({ tone: "info", text: "Previous signature discarded. Draw the signature again." });
    onChange(null);
    surfaceRef.current?.focus();
  }

  return (
    <div className={styles.root}>
      <div
        ref={surfaceRef}
        tabIndex={-1}
        className={`${styles.surface} ${value ? styles.surfaceSigned : ""} ${disabled ? styles.surfaceDisabled : ""}`}
      >
        <SignatureCanvas
          ref={padRef}
          penColor="#242424"
          clearOnResize={false}
          canvasProps={{
            className: styles.canvas,
            "aria-labelledby": labelledBy,
            "aria-label": labelledBy ? undefined : "Admin / Business Signature drawing area",
            "aria-disabled": disabled,
          }}
          onBegin={handleBegin}
          onEnd={handleEnd}
        />
        {!hasInk && !value ? (
          <span className={styles.placeholder} aria-hidden="true">Sign here</span>
        ) : null}
        <span className={styles.baseline} aria-hidden="true" />
      </div>

      <div className={styles.toolbar}>
        <span className={`${styles.status} ${value ? styles.statusDone : ""}`}>
          {value ? "✓ Signature captured" : "Signature required"}
        </span>
        <div className={styles.actions}>
          <Button
            variant="none"
            type="button"
            className={styles.action}
            onClick={handleClear}
            disabled={disabled || !hasInk}
          >
            Clear signature
          </Button>
          <Button
            variant="none"
            type="button"
            className={styles.action}
            onClick={handleRedo}
            disabled={disabled || !value}
          >
            Redo signature
          </Button>
        </div>
      </div>

      <p
        className={`${styles.message} ${message?.tone === "warning" ? styles.messageWarning : ""}`}
        role="status"
        aria-live="polite"
      >
        {message?.text ?? ""}
      </p>
    </div>
  );
}
