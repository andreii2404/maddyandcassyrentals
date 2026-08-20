"use client";

import Link from "next/link";
import type { ReactNode } from "react";
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

const CONFIRMATIONS: Array<{ key: keyof AgreementDraft; label: ReactNode }> = [
  {
    key: "infoAccurate",
    label: "I confirm that the information and documents I submitted are accurate.",
  },
  {
    key: "agreedToTerms",
    label: "I have read and agree to the Rental Terms and Conditions.",
  },
  {
    key: "understoodRentalRules",
    label:
      "I understand the rules regarding the rental period, item care, late returns, damage, loss, and missing accessories.",
  },
  {
    key: "authorizedESignature",
    label: "I authorize the use of my electronic signature for this Rental Agreement.",
  },
  {
    key: "readPrivacyNotice",
    label: (
      <>
        I have read and understood the{" "}
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
    key: "emergencyContactAuthorized",
    label:
      "I confirm that my emergency contact authorized me to provide their information and ID for this rental request.",
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
  const allChecked = CONFIRMATIONS.every((item) => Boolean(agreement[item.key]));
  const hasSignature =
    agreement.signatureMethod === "drawn"
      ? !!agreement.signatureDataUrl
      : !!agreement.signatureDataUrl;
  const canContinue =
    allChecked && hasSignature && agreement.typedFullName.trim().length > 1 && unitsReady && !unitsCheckError;

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.heading}>Rental Agreement &amp; Terms</h2>
      <p className={styles.subheading}>
        Please review the agreement below carefully before signing.
      </p>

      <AgreementDocument data={agreementData} />

      <div className={styles.agreementActionGrid}>
        <section>
          <h3 className={styles.sectionHeading}>Your Confirmations</h3>
          <div className={styles.confirmationsList}>
            {CONFIRMATIONS.map((item) => (
              <label key={item.key} className={formStyles.checkboxField}>
                <input
                  type="checkbox"
                  checked={Boolean(agreement[item.key])}
                  onChange={(event) => onUpdate({ [item.key]: event.target.checked } as Partial<AgreementDraft>)}
                />
                {item.label}
              </label>
            ))}
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
