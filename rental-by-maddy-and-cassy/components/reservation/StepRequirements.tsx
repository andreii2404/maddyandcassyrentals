"use client";

import { useEffect, useRef, useState } from "react";
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

interface SavedDocument {
  documentId: string;
  documentType: string;
  filename: string | null;
  mimeType: string | null;
  verifiedAt: string;
}

type ReusableSlot = "idOne" | "idTwo" | "selfie";

const REUSABLE_FIELDS: Array<{
  slot: ReusableSlot;
  fileKey: "idOneFile" | "idTwoFile" | "selfieFile";
  documentType: string;
  label: string;
  helpText?: string;
}> = [
  { slot: "idOne", fileKey: "idOneFile", documentType: "government_id", label: "First valid ID" },
  {
    slot: "idTwo",
    fileKey: "idTwoFile",
    documentType: "secondary_id",
    label: "Second valid ID",
    helpText: "At least one of your two IDs must show your current address and signature.",
  },
  { slot: "selfie", fileKey: "selfieFile", documentType: "selfie_with_id", label: "Selfie holding a valid ID" },
];

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

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function StepRequirements({
  requirements,
  onUpdate,
  onBack,
  onContinue,
}: StepRequirementsProps) {
  const [errors, setErrors] = useState<RequirementsErrors>({});
  const [savedDocuments, setSavedDocuments] = useState<SavedDocument[] | null>(null);
  const [replacing, setReplacing] = useState<Partial<Record<ReusableSlot, boolean>>>({});
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  // Latest draft values for the one-time prefill that runs when the saved
  // document lookup finishes, without re-running that effect on every keystroke.
  const requirementsRef = useRef(requirements);

  useEffect(() => {
    requirementsRef.current = requirements;
  }, [requirements]);

  useEffect(() => {
    let active = true;
    fetch("/api/account/verification-documents", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { documents?: SavedDocument[] } | null) => {
        if (!active) return;
        const documents = body?.documents ?? [];
        setSavedDocuments(documents);

        // Auto-reuse every verified document the customer has on file, unless
        // they already picked a replacement file for that slot in this session.
        const current = requirementsRef.current;
        const reused = { ...current.reusedDocumentIds };
        let changed = false;
        for (const field of REUSABLE_FIELDS) {
          const saved = documents.find((doc) => doc.documentType === field.documentType);
          if (saved && !current[field.fileKey] && !reused[field.slot]) {
            reused[field.slot] = saved.documentId;
            changed = true;
          }
        }
        if (changed) {
          onUpdate({ reusedDocumentIds: reused });
        }

        // Load small previews for image documents so customers can confirm
        // which ID is which before reusing it.
        for (const doc of documents) {
          if (doc.mimeType && !doc.mimeType.startsWith("image/")) continue;
          fetch(`/api/account/verification-documents/preview?documentId=${encodeURIComponent(doc.documentId)}`, {
            credentials: "same-origin",
          })
            .then((response) => (response.ok ? response.json() : null))
            .then((preview: { url?: string } | null) => {
              if (active && preview?.url) {
                setPreviewUrls((prev) => ({ ...prev, [doc.documentId]: preview.url! }));
              }
            })
            .catch(() => {
              // A missing preview never blocks the flow; the filename stays visible.
            });
        }
      })
      .catch(() => {
        if (active) setSavedDocuments([]);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRequirements(patch: Partial<RequirementsDraft>) {
    onUpdate(patch);
  }

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

  function startReplacement(slot: ReusableSlot, fileKey: "idOneFile" | "idTwoFile" | "selfieFile") {
    setReplacing((prev) => ({ ...prev, [slot]: true }));
    onUpdate({
      [fileKey]: null,
      reusedDocumentIds: { ...requirements.reusedDocumentIds, [slot]: null },
    } as Partial<RequirementsDraft>);
    clearFieldError(fileKey);
  }

  function cancelReplacement(slot: ReusableSlot, fileKey: "idOneFile" | "idTwoFile" | "selfieFile") {
    const saved = savedDocuments?.find((doc) => doc.documentType === REUSABLE_FIELDS.find((f) => f.slot === slot)?.documentType);
    setReplacing((prev) => ({ ...prev, [slot]: false }));
    onUpdate({
      [fileKey]: null,
      reusedDocumentIds: { ...requirements.reusedDocumentIds, [slot]: saved?.documentId ?? null },
    } as Partial<RequirementsDraft>);
    clearFieldError(fileKey);
  }

  function validate(): boolean {
    const nextErrors: RequirementsErrors = {};
    if (!requirements.idOneFile && !requirements.reusedDocumentIds.idOne) {
      nextErrors.idOneFile = "Please upload your first valid ID.";
    }
    if (!requirements.idTwoFile && !requirements.reusedDocumentIds.idTwo) {
      nextErrors.idTwoFile = "Please upload your second valid ID.";
    }
    if (!requirements.selfieFile && !requirements.reusedDocumentIds.selfie) {
      nextErrors.selfieFile = "Please upload a selfie holding a valid ID.";
    }
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

  const reusedCount = REUSABLE_FIELDS.filter(
    (field) => !requirements[field.fileKey] && requirements.reusedDocumentIds[field.slot],
  ).length;

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.heading}>Verification Document Submission</h2>
      <p className={styles.subheading}>
        Your reservation payment proof has been submitted and is pending admin verification. Now
        submit the documents needed to verify the renter. Accepted valid IDs: {ACCEPTED_ID_EXAMPLES}.
        At least one ID must show your current address and signature.
      </p>

      {reusedCount > 0 ? (
        <div className={styles.reuseNotice} role="status">
          <strong>Verified documents found</strong>
          <p>
            We found {reusedCount === 1 ? "a verified ID" : "verified IDs"} from your previous
            booking. They&apos;ll be reused automatically — choose “Replace” on any document if you
            want to upload a new copy instead. Replacing one never affects the others.
          </p>
        </div>
      ) : null}

      <div className={styles.documentGrid}>
        {REUSABLE_FIELDS.map((field) => {
          const file = requirements[field.fileKey];
          const reusedId = requirements.reusedDocumentIds[field.slot];
          const saved = savedDocuments?.find((doc) => doc.documentType === field.documentType) ?? null;
          const showSavedCard = Boolean(saved && reusedId && !file && !replacing[field.slot]);
          const previewUrl = saved ? previewUrls[saved.documentId] : undefined;

          if (showSavedCard && saved) {
            return (
              <div key={field.fileKey} id={field.fileKey} className={styles.savedDocCard}>
                <div className={styles.savedDocPreview}>
                  {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt={`${field.label} on file`} />
                  ) : (
                    <span aria-hidden="true">🪪</span>
                  )}
                </div>
                <div className={styles.savedDocInfo}>
                  <p className={styles.savedDocLabel}>{field.label}</p>
                  <p className={styles.savedDocMeta}>
                    {saved.filename || "Previously uploaded"}
                  </p>
                  <span className={styles.verifiedBadge}>✓ Verified</span>
                  <p className={styles.savedDocMeta}>Verified {formatDate(saved.verifiedAt)}</p>
                </div>
                <button
                  type="button"
                  className={styles.replaceButton}
                  onClick={() => startReplacement(field.slot, field.fileKey)}
                >
                  Replace ID
                </button>
              </div>
            );
          }

          return (
            <div key={field.fileKey}>
              <FileUploadField
                id={field.fileKey}
                label={field.label}
                required
                helpText={field.helpText}
                errorMessage={errors[field.fileKey]}
                value={file}
                onChange={(nextFile) => {
                  updateRequirements({
                    [field.fileKey]: nextFile,
                    reusedDocumentIds: { ...requirements.reusedDocumentIds, [field.slot]: null },
                  } as Partial<RequirementsDraft>);
                  if (nextFile) clearFieldError(field.fileKey);
                }}
              />
              {saved ? (
                <button
                  type="button"
                  className={styles.cancelReplaceButton}
                  onClick={() => cancelReplacement(field.slot, field.fileKey)}
                >
                  Cancel replacement — keep verified ID
                </button>
              ) : null}
            </div>
          );
        })}
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
