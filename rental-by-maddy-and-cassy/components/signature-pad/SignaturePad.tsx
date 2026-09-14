"use client";

import { useRef } from "react";
import SignatureCanvas from "react-signature-canvas";
import type { SignatureMethod } from "@/src/types/reservationDraft";
import { Button } from "@/components/ui/Button";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./SignaturePad.module.css";

interface SignaturePadProps {
  method: SignatureMethod;
  signatureDataUrl: string | null;
  onMethodChange: (method: SignatureMethod) => void;
  onSignatureChange: (dataUrl: string | null) => void;
}

export default function SignaturePad({
  method,
  signatureDataUrl,
  onMethodChange,
  onSignatureChange,
}: SignaturePadProps) {
  const canvasRef = useRef<SignatureCanvas>(null);

  function handleEnd() {
    const canvas = canvasRef.current;
    if (!canvas || canvas.isEmpty()) {
      onSignatureChange(null);
      return;
    }
    onSignatureChange(canvas.getTrimmedCanvas().toDataURL("image/png"));
  }

  function handleClear() {
    canvasRef.current?.clear();
    onSignatureChange(null);
  }

  function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      onSignatureChange(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  }

  function switchMethod(nextMethod: SignatureMethod) {
    onMethodChange(nextMethod);
    onSignatureChange(null);
    canvasRef.current?.clear();
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
           onClick={() => switchMethod("uploaded")}
         >
           Upload Signature Image
         </Button>
       </div>

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
              <Button variant="none" className={styles.clearButton} onClick={handleClear}>
                Clear Signature
              </Button>
            </div>
          ) : (
            <label className={styles.uploadDropzone}>
              <span>Click to upload a signature image</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleUpload}
                className={styles.hiddenInput}
              />
            </label>
          )}
        </div>
      )}

      {!signatureDataUrl ? (
        <p className={formStyles.helpText}>Your signature is required to continue.</p>
      ) : null}
    </div>
  );
}
