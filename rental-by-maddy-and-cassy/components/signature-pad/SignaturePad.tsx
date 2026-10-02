"use client";

import { useRef, useState } from "react";
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
}

export default function SignaturePad({
  method,
  signatureDataUrl,
  onMethodChange,
  onSignatureChange,
}: SignaturePadProps) {
  const canvasRef = useRef<SignatureCanvas>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  function handleEnd() {
    const canvas = canvasRef.current;
    if (!canvas || canvas.isEmpty()) {
      onSignatureChange(null, null);
      return;
    }
    onSignatureChange(canvas.getTrimmedCanvas().toDataURL("image/png"), null);
  }

  function handleClear() {
    canvasRef.current?.clear();
    setFileError(null);
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

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      onSignatureChange(dataUrl, dataUrl ? file : null);
    };
    reader.readAsDataURL(file);
  }

  function switchMethod(nextMethod: SignatureMethod) {
    setFileError(null);
    onMethodChange(nextMethod);
    canvasRef.current?.clear();
  }

  function handleUploadClick() {
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
         >
           Draw Signature
         </Button>
         <Button
           variant="none"
           role="tab"
           aria-selected={method === "uploaded"}
           className={`${styles.tab} ${method === "uploaded" ? styles.tabActive : ""}`}
           onClick={handleUploadClick}
         >
           Upload Signature Image
         </Button>
       </div>

      <input
        ref={fileInputRef}
        id="signature-image-upload"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleUpload}
        className={styles.hiddenInput}
        tabIndex={method === "uploaded" && !signatureDataUrl ? 0 : -1}
        aria-label="Upload signature image"
      />

      {method === "drawn" ? (
        <div className={styles.canvasWrapper}>
          <SignatureCanvas
            ref={canvasRef}
            penColor="#242424"
            canvasProps={{ className: styles.canvas, "aria-label": "Draw your signature" }}
            onEnd={handleEnd}
          />
          <Button variant="none" className={styles.clearButton} onClick={handleClear}>
            Clear Signature
          </Button>
        </div>
      ) : (
        <div className={styles.uploadWrapper}>
          {signatureDataUrl ? (
            <div className={styles.uploadPreview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signatureDataUrl} alt="Uploaded signature preview" />
              <Button variant="none" className={styles.clearButton} onClick={handleUploadClick}>
                Replace Signature Image
              </Button>
              <Button variant="none" className={styles.clearButton} onClick={handleClear}>
                Clear Signature
              </Button>
            </div>
          ) : (
            <label className={styles.uploadDropzone} htmlFor="signature-image-upload">
              <span>Click to upload a signature image</span>
            </label>
          )}
        </div>
      )}

      {!signatureDataUrl ? (
        <p className={formStyles.helpText}>Your signature is required to continue.</p>
      ) : null}
      {fileError ? <p className={formStyles.errorText} role="alert">{fileError}</p> : null}
    </div>
  );
}
