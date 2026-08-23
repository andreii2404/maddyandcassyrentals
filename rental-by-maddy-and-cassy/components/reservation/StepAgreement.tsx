"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgreementDraft } from "@/src/types/reservationDraft";
import AgreementDocument, { type AgreementDocumentData } from "./AgreementDocument";
import SignaturePad from "@/components/signature-pad/SignaturePad";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./StepShared.module.css";

interface StepAgreementProps {
  agreementData: AgreementDocumentData;
  agreement: AgreementDraft;
  onUpdate: (patch: Partial<AgreementDraft>) => void;
  onBack: () => void;
  onContinue: () => void;
  submitting?: boolean;
  /**
   * False while assigned-unit codes/serials are still being confirmed, or if
   * that confirmation failed -- Sign stays disabled either way. Every
   * booking-creation RPC only ever returns a booking after fully allocating
   * units, so this is a loading/defensive gate, never expected to fail.
   */
  unitsReady?: boolean;
  unitsCheckError?: string | null;
}

const CONFIRMATION_GROUPS: Array<{
  title: string;
  keys: Array<keyof AgreementDraft>;
  label: ReactNode;
}> = [
  {
    title: "Information & privacy",
    keys: ["infoAccurate", "readPrivacyNotice", "emergencyContactAuthorized"],
    label: (
      <>
        I confirm that my information and documents are accurate, my emergency contact authorized
        their details, and I have read the{" "}
        <Link
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.inlineLink}
        >
          Privacy Notice
        </Link>
        .
      </>
    ),
  },
  {
    title: "Rental terms & signature",
    keys: ["agreedToTerms", "understoodRentalRules", "authorizedESignature"],
    label:
      "I agree to the Rental Terms, understand the return, care, damage, loss, and late-return rules, and authorize my electronic signature.",
  },
];

export default function StepAgreement({
  agreementData,
  agreement,
  onUpdate,
  onBack,
  onContinue,
  submitting = false,
  unitsReady = true,
  unitsCheckError = null,
}: StepAgreementProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const expandDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isExpanded) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsExpanded(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    expandDialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isExpanded]);

  const allChecked = CONFIRMATION_GROUPS.every((group) =>
    group.keys.every((key) => Boolean(agreement[key])),
  );
  const hasSignature =
    agreement.signatureMethod === "drawn"
      ? !!agreement.signatureDataUrl
      : !!agreement.signatureDataUrl;
  const canContinue =
    allChecked && hasSignature && agreement.typedFullName.trim().length > 1 && unitsReady && !unitsCheckError;

  return (
    <div className={styles.wrapper}>
      <div className={styles.viewerToolbar}>
        <div>
          <h2 className={styles.heading}>Rental Agreement &amp; Terms</h2>
          <p className={styles.viewerHint}>Review the agreement, confirm both statements, then sign.</p>
        </div>
        <button
          type="button"
          className={styles.expandButton}
          onClick={() => setIsExpanded(true)}
        >
          Expand Agreement
        </button>
      </div>
      <AgreementDocument data={agreementData} />

      {isExpanded ? (
        <div className={styles.expandOverlay} onMouseDown={() => setIsExpanded(false)}>
          <div
            ref={expandDialogRef}
            className={styles.expandDialog}
            role="dialog"
            aria-modal="true"
            aria-label="Rental Agreement"
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.expandHeader}>
              <h3 className={styles.expandTitle}>Rental Agreement</h3>
              <button
                type="button"
                className={styles.expandCloseButton}
                onClick={() => setIsExpanded(false)}
                aria-label="Minimize agreement"
              >
                Close &amp; Minimize
              </button>
            </div>
            <div className={styles.expandBody}>
              <AgreementDocument data={agreementData} variant="expanded" />
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.agreementActionGrid}>
        <section>
          <h3 className={styles.sectionHeading}>Your Confirmations</h3>
          <div className={styles.confirmationsList}>
            {CONFIRMATION_GROUPS.map((group) => {
              const checked = group.keys.every((key) => Boolean(agreement[key]));
              return (
              <label key={group.title} className={`${formStyles.checkboxField} ${styles.confirmationGroup}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const patch = Object.fromEntries(
                      group.keys.map((key) => [key, event.target.checked]),
                    ) as Partial<AgreementDraft>;
                    onUpdate(patch);
                  }}
                />
                <span>
                  <strong>{group.title}</strong>
                  <small>{group.label}</small>
                </span>
              </label>
              );
            })}
          </div>
        </section>

        <section className={styles.signatureSection}>
          <h3 className={styles.sectionHeading}>Electronic Signature</h3>
          <SignaturePad
            method={agreement.signatureMethod}
            signatureDataUrl={agreement.signatureDataUrl}
            onMethodChange={(signatureMethod) => onUpdate({ signatureMethod })}
            onSignatureChange={(signatureDataUrl) => onUpdate({ signatureDataUrl })}
          />

          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="typedFullName">
              Type your full name to sign<span className={formStyles.required}>*</span>
            </label>
            <input
              id="typedFullName"
              name="agreementSignerName"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              className={formStyles.input}
              value={agreement.typedFullName}
              onChange={(event) => onUpdate({ typedFullName: event.target.value })}
              placeholder="Your full legal name"
            />
            <p className={formStyles.helpText}>
              Signed on {new Date().toLocaleString()} — recorded at submission.
            </p>
          </div>
        </section>
      </div>

      {unitsCheckError ? (
        <p className={formStyles.errorText} role="alert">
          {unitsCheckError}
        </p>
      ) : null}

      <div className={styles.footer}>
        <button
          type="button"
          className={formStyles.secondaryButton}
          onClick={onBack}
          disabled={submitting}
        >
          Back
        </button>
        <button
          type="button"
          className={formStyles.primaryButton}
          disabled={!canContinue || submitting}
          onClick={onContinue}
        >
          {submitting
            ? "Submitting…"
            : !unitsReady && !unitsCheckError
              ? "Confirming assigned units…"
              : "Sign & Submit Agreement"}
        </button>
      </div>
    </div>
  );
}
