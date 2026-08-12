"use client";

import { useState } from "react";
import Link from "next/link";
import type { RequirementsDraft } from "@/src/types/reservationDraft";
import FileUploadField from "@/components/file-upload/FileUploadField";
import { isValidPhoneNumber, normalizePhoneInput, PHONE_DIGIT_COUNT } from "@/src/lib/authValidation";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./StepShared.module.css";

interface StepRequirementsProps {
  requirements: RequirementsDraft;
  onUpdate: (patch: Partial<RequirementsDraft>) => void;
  onBack: () => void;
  onContinue: () => void;
}

const ACCEPTED_ID_EXAMPLES = "Passport, National ID, Driver's License, or School ID";

function isPlatformUrl(value: string, domains: string[]): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      domains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

export default function StepRequirements({
  requirements,
  onUpdate,
  onBack,
  onContinue,
}: StepRequirementsProps) {
  const [errors, setErrors] = useState<string[]>([]);

  function updateEmergencyContact(patch: Partial<RequirementsDraft["emergencyContact"]>) {
    onUpdate({ emergencyContact: { ...requirements.emergencyContact, ...patch } });
  }

  function validate(): boolean {
    const nextErrors: string[] = [];
    if (!requirements.idOneFile) nextErrors.push("Please upload your first valid ID.");
    if (!requirements.idTwoFile) nextErrors.push("Please upload your second valid ID.");
    if (!requirements.selfieFile) nextErrors.push("Please upload a selfie holding a valid ID.");
    if (!isPlatformUrl(requirements.facebookLink.trim(), ["facebook.com", "fb.com"])) {
      nextErrors.push("Enter a valid active Facebook profile link.");
    }
    if (!isPlatformUrl(requirements.instagramLink.trim(), ["instagram.com"])) {
      nextErrors.push("Enter a valid active Instagram profile link.");
    }
    if (!requirements.emergencyContact.fullName.trim()) nextErrors.push("Emergency contact full name is required.");
    if (!requirements.emergencyContact.relationship.trim()) nextErrors.push("Emergency contact relationship is required.");
    if (!isValidPhoneNumber(requirements.emergencyContact.phone)) {
      nextErrors.push(`Emergency contact phone number must contain exactly ${PHONE_DIGIT_COUNT} digits.`);
    }
    if (
      !isPlatformUrl(
        requirements.emergencyContact.facebookLink.trim(),
        ["facebook.com", "fb.com"],
      )
    ) {
      nextErrors.push("Enter the emergency contact's valid Facebook link.");
    }
    if (!requirements.emergencyContact.idFile) nextErrors.push("Emergency contact's government-issued ID is required.");

    setErrors(nextErrors);
    return nextErrors.length === 0;
  }

  function handleContinue() {
    if (validate()) onContinue();
  }

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.heading}>Verification Document Submission</h2>
      <p className={styles.subheading}>
        Your reservation payment has been verified. Now submit the documents needed to verify
        the renter. Accepted valid IDs: {ACCEPTED_ID_EXAMPLES}. At least one ID must show your
        current address and signature.
      </p>

      <div className={styles.documentGrid}>
        <FileUploadField
          label="First valid ID"
          required
          value={requirements.idOneFile}
          onChange={(file) => onUpdate({ idOneFile: file })}
        />
        <FileUploadField
          label="Second valid ID"
          required
          helpText="At least one of your two IDs must show your current address and signature."
          value={requirements.idTwoFile}
          onChange={(file) => onUpdate({ idTwoFile: file })}
        />
        <FileUploadField
          label="Selfie holding a valid ID"
          required
          value={requirements.selfieFile}
          onChange={(file) => onUpdate({ selfieFile: file })}
        />
      </div>

      <div className={formStyles.row}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="req-facebook">
            Active Facebook profile link<span className={formStyles.required}>*</span>
          </label>
          <input
            id="req-facebook"
            type="url"
            className={formStyles.input}
            value={requirements.facebookLink}
            onChange={(event) => onUpdate({ facebookLink: event.target.value })}
          />
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="req-instagram">
            Active Instagram profile link<span className={formStyles.required}>*</span>
          </label>
          <input
            id="req-instagram"
            type="url"
            className={formStyles.input}
            value={requirements.instagramLink}
            onChange={(event) => onUpdate({ instagramLink: event.target.value })}
          />
        </div>
      </div>

      <h3 className={styles.sectionHeading}>Emergency Contact</h3>

      <div className={formStyles.row}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="ec-name">
            Full name<span className={formStyles.required}>*</span>
          </label>
          <input
            id="ec-name"
            className={formStyles.input}
            value={requirements.emergencyContact.fullName}
            onChange={(event) => updateEmergencyContact({ fullName: event.target.value })}
          />
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="ec-relationship">
            Relationship to you<span className={formStyles.required}>*</span>
          </label>
          <input
            id="ec-relationship"
            className={formStyles.input}
            value={requirements.emergencyContact.relationship}
            onChange={(event) => updateEmergencyContact({ relationship: event.target.value })}
          />
        </div>
      </div>

      <div className={formStyles.row}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="ec-phone">
            Active phone number<span className={formStyles.required}>*</span>
          </label>
          <input
            id="ec-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={PHONE_DIGIT_COUNT}
            placeholder="09XXXXXXXXX"
            className={formStyles.input}
            value={requirements.emergencyContact.phone}
            onChange={(event) => updateEmergencyContact({ phone: normalizePhoneInput(event.target.value) })}
          />
          <p className={formStyles.helpText}>Use exactly 11 digits.</p>
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="ec-facebook">
            Facebook profile link<span className={formStyles.required}>*</span>
          </label>
          <input
            id="ec-facebook"
            type="url"
            className={formStyles.input}
            value={requirements.emergencyContact.facebookLink}
            onChange={(event) => updateEmergencyContact({ facebookLink: event.target.value })}
          />
        </div>
      </div>

      <FileUploadField
        label="Emergency contact's government-issued ID"
        required
        value={requirements.emergencyContact.idFile}
        onChange={(file) => updateEmergencyContact({ idFile: file })}
      />

      <div className={styles.privacyNotice}>
        <strong>Privacy notice</strong>
        <p>
          These details and documents are collected for identity verification,
          fraud prevention, booking administration, rental agreements, and
          rental-related incidents. Private files are limited to you and active
          administrators. Read the complete{" "}
          <Link href="/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Notice
          </Link>
          .
        </p>
      </div>

      {errors.length > 0 ? (
        <ul className={formStyles.errorText} role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <div className={styles.footer}>
        <button type="button" className={formStyles.secondaryButton} onClick={onBack}>
          Back
        </button>
        <button type="button" className={formStyles.primaryButton} onClick={handleContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
