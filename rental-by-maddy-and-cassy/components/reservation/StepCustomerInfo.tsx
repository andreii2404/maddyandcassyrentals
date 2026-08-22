"use client";

import { useState } from "react";
import { formatCustomerAddress, type CustomerInfoDraft } from "@/src/types/reservationDraft";
import { PHILIPPINE_PROVINCES } from "@/src/data/philippineLocations";
import { updateUserProfile } from "@/src/services/userService";
import {
  getMaxBirthDate,
  isAtLeastMinimumAge,
  isValidPhoneNumber,
  normalizePhoneInput,
  PHONE_DIGIT_COUNT,
  UNDERAGE_ERROR_MESSAGE,
} from "@/src/lib/authValidation";
import { scrollToFirstError } from "@/src/lib/formScroll";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./StepShared.module.css";

const FIELD_ORDER: Array<keyof CustomerInfoDraft> = [
  "fullName",
  "email",
  "phone",
  "birthDate",
  "streetBarangay",
  "cityMunicipality",
  "province",
  "facebookLink",
  "instagramLink",
];

interface StepCustomerInfoProps {
  uid: string;
  customerInfo: CustomerInfoDraft;
  onUpdate: (patch: Partial<CustomerInfoDraft>) => void;
  onBack?: () => void;
  onContinue: () => void;
  isGuest?: boolean;
  birthDateLocked?: boolean;
  birthDateVerified?: boolean;
}

export default function StepCustomerInfo({
  uid,
  customerInfo,
  onUpdate,
  onBack,
  onContinue,
  isGuest = false,
  birthDateLocked = false,
  birthDateVerified = false,
}: StepCustomerInfoProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerInfoDraft, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function validate(): boolean {
    const nextErrors: Partial<Record<keyof CustomerInfoDraft, string>> = {};
    if (!customerInfo.fullName.trim()) nextErrors.fullName = "Full name is required.";
    if (!customerInfo.email.trim() || !/\S+@\S+\.\S+/.test(customerInfo.email)) {
      nextErrors.email = "A valid email address is required.";
    }
    if (!isValidPhoneNumber(customerInfo.phone)) {
      nextErrors.phone = `Phone number must contain exactly ${PHONE_DIGIT_COUNT} digits.`;
    }
    if (customerInfo.birthDate && new Date(`${customerInfo.birthDate}T00:00:00`) > new Date()) {
      nextErrors.birthDate = "Birth date cannot be in the future.";
    } else if (customerInfo.birthDate && !isAtLeastMinimumAge(customerInfo.birthDate)) {
      nextErrors.birthDate = UNDERAGE_ERROR_MESSAGE;
    }
    if (!customerInfo.streetBarangay.trim()) nextErrors.streetBarangay = "Street and barangay are required.";
    if (!customerInfo.cityMunicipality.trim()) nextErrors.cityMunicipality = "City or municipality is required.";
    if (!customerInfo.province.trim()) nextErrors.province = "Province is required.";
    if (!customerInfo.facebookLink.trim()) nextErrors.facebookLink = "Your Facebook profile link is required.";
    if (!customerInfo.instagramLink.trim()) nextErrors.instagramLink = "Your Instagram profile link is required.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      scrollToFirstError(FIELD_ORDER, nextErrors);
    }
    return Object.keys(nextErrors).length === 0;
  }

  function clearFieldError(field: keyof CustomerInfoDraft) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function handleContinue() {
    if (!validate()) return;

    // Guest checkout is an anonymous Supabase session, not a customer
    // account -- the details entered here belong on the booking snapshot
    // only (see bookingSubmissionService), not on a persisted profile row.
    if (isGuest) {
      onContinue();
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await updateUserProfile(uid, {
        email: customerInfo.email.trim(),
        displayName: customerInfo.fullName,
        phoneNumber: customerInfo.phone.trim(),
        birthDate: customerInfo.birthDate,
        fullAddress: formatCustomerAddress(customerInfo),
        facebookLink: customerInfo.facebookLink,
        instagramLink: customerInfo.instagramLink,
      });
      onContinue();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setSaveError(
        /session|expired|unauthenticated|permission denied/i.test(message)
          ? "Your sign-in session expired. Sign in again, then this reservation will resume from the same booking."
          : message || "We couldn't save your rental details. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.heading}>Rental Details</h2>
      <p className={styles.subheading}>
        Confirm the renter information that will appear on this reservation, invoice, receipt,
        and rental agreement.
      </p>
      {isGuest ? (
        <p className={styles.confirmCallout}>
          Guest checkout is active. Use an email you can access because booking updates will use it.
        </p>
      ) : null}

      <div className={formStyles.row}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="fullName">
            Full name<span className={formStyles.required}>*</span>
          </label>
          <input
            id="fullName"
            className={`${formStyles.input} ${errors.fullName ? formStyles.inputError : ""}`}
            value={customerInfo.fullName}
            onChange={(event) => {
              const value = event.target.value;
              onUpdate({ fullName: value });
              if (value.trim()) clearFieldError("fullName");
            }}
          />
          {errors.fullName ? <p className={formStyles.errorText}>{errors.fullName}</p> : null}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="email">
            Email address<span className={formStyles.required}>*</span>
          </label>
          <input
            id="email"
            type="email"
            className={`${formStyles.input} ${errors.email ? formStyles.inputError : ""}`}
            value={customerInfo.email}
            onChange={(event) => {
              const value = event.target.value;
              onUpdate({ email: value });
              if (value.trim() && /\S+@\S+\.\S+/.test(value)) clearFieldError("email");
            }}
          />
          {errors.email ? <p className={formStyles.errorText}>{errors.email}</p> : null}
        </div>
      </div>

      <div className={formStyles.row}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="phone">
            Active phone number<span className={formStyles.required}>*</span>
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={PHONE_DIGIT_COUNT}
            placeholder="09XXXXXXXXX"
            className={`${formStyles.input} ${errors.phone ? formStyles.inputError : ""}`}
            value={customerInfo.phone}
            onChange={(event) => {
              const value = normalizePhoneInput(event.target.value);
              onUpdate({ phone: value });
              if (isValidPhoneNumber(value)) clearFieldError("phone");
            }}
          />
          <p className={formStyles.helpText}>Use exactly 11 digits.</p>
          {errors.phone ? <p className={formStyles.errorText}>{errors.phone}</p> : null}
        </div>

        {!isGuest ? (
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="birthDate">
              Birth date <span className={styles.optional}>(birthday perk)</span>
            </label>
            <input
              id="birthDate"
              type="date"
              autoComplete="bday"
              max={getMaxBirthDate()}
              disabled={birthDateLocked}
              className={`${formStyles.input} ${errors.birthDate ? formStyles.inputError : ""}`}
              value={customerInfo.birthDate}
              onChange={(event) => {
                const value = event.target.value;
                onUpdate({ birthDate: value });
                const isFutureDate = value && new Date(`${value}T00:00:00`) > new Date();
                if (!value || (!isFutureDate && isAtLeastMinimumAge(value))) {
                  clearFieldError("birthDate");
                }
              }}
            />
            <p className={styles.fieldNote}>
              {birthDateVerified
                ? "Verified. Eligible birth-month rentals receive ₱100 off automatically."
                : "Optional. The date must match the valid ID submitted during verification."}
            </p>
            {errors.birthDate ? <p className={formStyles.errorText}>{errors.birthDate}</p> : null}
          </div>
        ) : null}
      </div>

      <div className={formStyles.field}>
        <label className={formStyles.label} htmlFor="streetBarangay">
          Street / Barangay<span className={formStyles.required}>*</span>
        </label>
        <input
          id="streetBarangay"
          autoComplete="address-line1"
          placeholder="House/unit number, street, subdivision, and barangay"
          className={`${formStyles.input} ${errors.streetBarangay ? formStyles.inputError : ""}`}
          value={customerInfo.streetBarangay}
          onChange={(event) => {
            const value = event.target.value;
            onUpdate({ streetBarangay: value });
            if (value.trim()) clearFieldError("streetBarangay");
          }}
        />
        {errors.streetBarangay ? <p className={formStyles.errorText}>{errors.streetBarangay}</p> : null}
      </div>

      <div className={formStyles.row}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="cityMunicipality">
            City / Municipality<span className={formStyles.required}>*</span>
          </label>
          <input
            id="cityMunicipality"
            autoComplete="address-level2"
            placeholder="e.g. Manila"
            className={`${formStyles.input} ${errors.cityMunicipality ? formStyles.inputError : ""}`}
            value={customerInfo.cityMunicipality}
            onChange={(event) => {
              const value = event.target.value;
              onUpdate({ cityMunicipality: value });
              if (value.trim()) clearFieldError("cityMunicipality");
            }}
          />
          {errors.cityMunicipality ? <p className={formStyles.errorText}>{errors.cityMunicipality}</p> : null}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="province">
            Province<span className={formStyles.required}>*</span>
          </label>
          <select
            id="province"
            autoComplete="address-level1"
            className={`${formStyles.select} ${errors.province ? formStyles.inputError : ""}`}
            value={customerInfo.province}
            onChange={(event) => {
              const value = event.target.value;
              onUpdate({ province: value });
              if (value.trim()) clearFieldError("province");
            }}
          >
            <option value="">Select province</option>
            {PHILIPPINE_PROVINCES.map((province) => (
              <option key={province} value={province}>{province}</option>
            ))}
          </select>
          {errors.province ? <p className={formStyles.errorText}>{errors.province}</p> : null}
        </div>
      </div>

      <div className={formStyles.row}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="facebookLink">
            Facebook profile link<span className={formStyles.required}>*</span>
          </label>
          <input
            id="facebookLink"
            type="url"
            placeholder="https://facebook.com/yourprofile"
            className={`${formStyles.input} ${errors.facebookLink ? formStyles.inputError : ""}`}
            value={customerInfo.facebookLink}
            onChange={(event) => {
              const value = event.target.value;
              onUpdate({ facebookLink: value });
              if (value.trim()) clearFieldError("facebookLink");
            }}
          />
          {errors.facebookLink ? <p className={formStyles.errorText}>{errors.facebookLink}</p> : null}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="instagramLink">
            Instagram profile link<span className={formStyles.required}>*</span>
          </label>
          <input
            id="instagramLink"
            type="url"
            placeholder="https://instagram.com/yourprofile"
            className={`${formStyles.input} ${errors.instagramLink ? formStyles.inputError : ""}`}
            value={customerInfo.instagramLink}
            onChange={(event) => {
              const value = event.target.value;
              onUpdate({ instagramLink: value });
              if (value.trim()) clearFieldError("instagramLink");
            }}
          />
          {errors.instagramLink ? <p className={formStyles.errorText}>{errors.instagramLink}</p> : null}
        </div>
      </div>

      {saveError ? <p className={formStyles.errorText} role="alert">{saveError}</p> : null}

      <div className={styles.footer}>
        {onBack ? (
          <button type="button" className={formStyles.secondaryButton} onClick={onBack}>
            Back
          </button>
        ) : <span />}
        <button
          type="button"
          className={formStyles.primaryButton}
          disabled={saving}
          onClick={handleContinue}
        >
          {saving ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
