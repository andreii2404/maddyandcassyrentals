"use client";

import { useState } from "react";
import Link from "next/link";
import type { RequirementsDraft } from "@/src/types/reservationDraft";
import FileUploadField from "@/components/file-upload/FileUploadField";
import { isValidPhoneNumber, normalizePhoneInput, PHONE_DIGIT_COUNT } from "@/src/lib/authValidation";
import { scrollToFirstError } from "@/src/lib/formScroll";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./StepShared.module.css";

interface StepRequirementsProps {
  requirements: RequirementsDraft;
  onUpdate: (patch: Partial<RequirementsDraft>) => void;
  onBack: () => void;
  onContinue: () => void;
}

const ACCEPTED_ID_EXAMPLES = "Passport, National ID, Driver's License, or School ID";

type RequirementsErrors = Partial<Record<string, string>>;

const FIELD_ORDER = [
  "idOneFile",
  "idTwoFile",
  "selfieFile",
  "req-facebook",
  "req-instagram",
  "ec-name",
  "ec-relationship",
  "ec-phone",
  "ec-facebook",
  "ec-idFile",
];

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
  const [errors, setErrors] = useState<RequirementsErrors>({});

  function updateEmergencyContact(patch: Partial<RequirementsDraft["emergencyContact"]>) {
    onUpdate({ emergencyContact: { ...requirements.emergencyContact, ...patch } });
  }

  function clearFieldError(field: string) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validate(): boolean {
    const nextErrors: RequirementsErrors = {};
    if (!requirements.idOneFile) nextErrors.idOneFile = "Please upload your first valid ID.";
    if (!requirements.idTwoFile) nextErrors.idTwoFile = "Please upload your second valid ID.";
    if (!requirements.selfieFile) nextErrors.selfieFile = "Please upload a selfie holding a valid ID.";
    if (!isPlatformUrl(requirements.facebookLink.trim(), ["facebook.com", "fb.com"])) {
      nextErrors["req-facebook"] = "Enter a valid active Facebook profile link.";
    }
    if (!isPlatformUrl(requirements.instagramLink.trim(), ["instagram.com"])) {
      nextErrors["req-instagram"] = "Enter a valid active Instagram profile link.";
    }
    if (!requirements.emergencyContact.fullName.trim()) {
      nextErrors["ec-name"] = "Emergency contact full name is required.";
    }
    if (!requirements.emergencyContact.relationship.trim()) {
      nextErrors["ec-relationship"] = "Emergency contact relationship is required.";
    }
    if (!isValidPhoneNumber(requirements.emergencyContact.phone)) {
      nextErrors["ec-phone"] = `Emergency contact phone number must contain exactly ${PHONE_DIGIT_COUNT} digits.`;
    }
    if (
      !isPlatformUrl(
        requirements.emergencyContact.facebookLink.trim(),
        ["facebook.com", "fb.com"],
      )
    ) {
      nextErrors["ec-facebook"] = "Enter the emergency contact's valid Facebook link.";
    }
    if (!requirements.emergencyContact.idFile) {
      nextErrors["ec-idFile"] = "Emergency contact's government-issued ID is required.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      scrollToFirstError(FIELD_ORDER, nextErrors);
    }
    return Object.keys(nextErrors).length === 0;
  }

  function handleContinue() {
    if (validate()) onContinue();
  }

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.heading}>Verification Document Submission</h2>
      <p className={styles.subheading}>
        Your reservation payment proof has been submitted and is pending admin verification. Now
        submit the documents needed to verify the renter. Accepted valid IDs: {ACCEPTED_ID_EXAMPLES}.
        At least one ID must show your current address and signature.
      </p>

      <div className={styles.documentGrid}>
        <FileUploadField
          id="idOneFile"
          label="First valid ID"
          required
          errorMessage={errors.idOneFile}
          value={requirements.idOneFile}
          onChange={(file) => onUpdate({ idOneFile: file })}
        />
        <FileUploadField
          id="idTwoFile"
          label="Second valid ID"
          required
          helpText="At least one of your two IDs must show your current address and signature."
          errorMessage={errors.idTwoFile}
          value={requirements.idTwoFile}
          onChange={(file) => onUpdate({ idTwoFile: file })}
        />
        <FileUploadField
          id="selfieFile"
          label="Selfie holding a valid ID"
          required
          errorMessage={errors.selfieFile}
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
            className={`${formStyles.input} ${errors["req-facebook"] ? formStyles.inputError : ""}`}
            value={requirements.facebookLink}
            onChange={(event) => {
              const value = event.target.value;
              onUpdate({ facebookLink: value });
              if (isPlatformUrl(value.trim(), ["facebook.com", "fb.com"])) clearFieldError("req-facebook");
            }}
          />
          {errors["req-facebook"] ? <p className={formStyles.errorText}>{errors["req-facebook"]}</p> : null}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="req-instagram">
            Active Instagram profile link<span className={formStyles.required}>*</span>
          </label>
          <input
            id="req-instagram"
            type="url"
            className={`${formStyles.input} ${errors["req-instagram"] ? formStyles.inputError : ""}`}
            value={requirements.instagramLink}
            onChange={(event) => {
              const value = event.target.value;
              onUpdate({ instagramLink: value });
              if (isPlatformUrl(value.trim(), ["instagram.com"])) clearFieldError("req-instagram");
            }}
          />
          {errors["req-instagram"] ? <p className={formStyles.errorText}>{errors["req-instagram"]}</p> : null}
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
            className={`${formStyles.input} ${errors["ec-name"] ? formStyles.inputError : ""}`}
            value={requirements.emergencyContact.fullName}
            onChange={(event) => {
              const value = event.target.value;
              updateEmergencyContact({ fullName: value });
              if (value.trim()) clearFieldError("ec-name");
            }}
          />
          {errors["ec-name"] ? <p className={formStyles.errorText}>{errors["ec-name"]}</p> : null}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="ec-relationship">
            Relationship to you<span className={formStyles.required}>*</span>
          </label>
          <input
            id="ec-relationship"
            className={`${formStyles.input} ${errors["ec-relationship"] ? formStyles.inputError : ""}`}
            value={requirements.emergencyContact.relationship}
            onChange={(event) => {
              const value = event.target.value;
              updateEmergencyContact({ relationship: value });
              if (value.trim()) clearFieldError("ec-relationship");
            }}
          />
          {errors["ec-relationship"] ? <p className={formStyles.errorText}>{errors["ec-relationship"]}</p> : null}
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
            className={`${formStyles.input} ${errors["ec-phone"] ? formStyles.inputError : ""}`}
            value={requirements.emergencyContact.phone}
            onChange={(event) => {
              const value = normalizePhoneInput(event.target.value);
              updateEmergencyContact({ phone: value });
              if (isValidPhoneNumber(value)) clearFieldError("ec-phone");
            }}
          />
          <p className={formStyles.helpText}>Use exactly 11 digits.</p>
          {errors["ec-phone"] ? <p className={formStyles.errorText}>{errors["ec-phone"]}</p> : null}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="ec-facebook">
            Facebook profile link<span className={formStyles.required}>*</span>
          </label>
          <input
            id="ec-facebook"
            type="url"
            className={`${formStyles.input} ${errors["ec-facebook"] ? formStyles.inputError : ""}`}
            value={requirements.emergencyContact.facebookLink}
            onChange={(event) => {
              const value = event.target.value;
              updateEmergencyContact({ facebookLink: value });
              if (isPlatformUrl(value.trim(), ["facebook.com", "fb.com"])) clearFieldError("ec-facebook");
            }}
          />
          {errors["ec-facebook"] ? <p className={formStyles.errorText}>{errors["ec-facebook"]}</p> : null}
        </div>
      </div>

      <FileUploadField
        id="ec-idFile"
        label="Emergency contact's government-issued ID"
        required
        errorMessage={errors["ec-idFile"]}
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
