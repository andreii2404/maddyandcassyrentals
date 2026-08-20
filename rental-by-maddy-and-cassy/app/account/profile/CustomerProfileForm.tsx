"use client";

import { useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { updateUserProfile } from "@/src/services/userService";
import type { UserProfile } from "@/src/types/database";
import { useToast } from "@/components/ui/ToastProvider";
import formStyles from "@/components/ui/Form.module.css";
import Spinner from "@/components/ui/Spinner";
import styles from "./profile.module.css";
import PushNotificationButton from "@/components/push/PushNotificationButton";
import {
  getMaxBirthDate,
  isAtLeastMinimumAge,
  isValidPhoneNumber,
  normalizePhoneInput,
  PHONE_DIGIT_COUNT,
  UNDERAGE_ERROR_MESSAGE,
} from "@/src/lib/authValidation";

interface ProfileDraft {
  displayName: string;
  phoneNumber: string;
  birthDate: string;
  fullAddress: string;
  facebookLink: string;
  instagramLink: string;
}

function draftFromProfile(profile: UserProfile): ProfileDraft {
  return {
    displayName: profile.displayName ?? "",
    phoneNumber: profile.phoneNumber ?? "",
    birthDate: profile.birthDate ?? "",
    fullAddress: profile.fullAddress ?? "",
    facebookLink: profile.facebookLink ?? "",
    instagramLink: profile.instagramLink ?? "",
  };
}

function isValidProfileUrl(value: string, allowedDomains: string[]): boolean {
  try {
    const url = new URL(value);
    const usesWebProtocol = url.protocol === "http:" || url.protocol === "https:";
    const matchesPlatform = allowedDomains.some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );
    return usesWebProtocol && matchesPlatform;
  } catch {
    return false;
  }
}

export default function CustomerProfileForm() {
  const { user, profile, refreshProfile } = useAuth();

  if (!profile || !user) {
    return (
      <div className={styles.loading}>
        <Spinner size={26} label="Loading your profile" />
      </div>
    );
  }

  return (
    <CustomerProfileEditor
      key={profile.updatedAt ?? profile.id}
      user={user}
      profile={profile}
      refreshProfile={refreshProfile}
    />
  );
}

interface CustomerProfileEditorProps {
  user: User;
  profile: UserProfile;
  refreshProfile: () => Promise<void>;
}

function CustomerProfileEditor({
  user,
  profile,
  refreshProfile,
}: CustomerProfileEditorProps) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromProfile(profile));
  const [saving, setSaving] = useState(false);

  function updateDraft(field: keyof ProfileDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    if (draft.displayName.trim().length < 2) {
      showToast("Please enter your full name.", "error");
      return;
    }

    if (!isValidPhoneNumber(draft.phoneNumber)) {
      showToast(`Phone number must contain exactly ${PHONE_DIGIT_COUNT} digits.`, "error");
      return;
    }

    if (draft.birthDate && new Date(`${draft.birthDate}T00:00:00`) > new Date()) {
      showToast("Birth date cannot be in the future.", "error");
      return;
    }

    if (draft.birthDate && !isAtLeastMinimumAge(draft.birthDate)) {
      showToast(UNDERAGE_ERROR_MESSAGE, "error");
      return;
    }

    if (!draft.fullAddress.trim()) {
      showToast("Full address is required.", "error");
      return;
    }

    if (!isValidProfileUrl(draft.facebookLink.trim(), ["facebook.com", "fb.com"])) {
      showToast("Enter a valid Facebook profile link.", "error");
      return;
    }

    if (!isValidProfileUrl(draft.instagramLink.trim(), ["instagram.com"])) {
      showToast("Enter a valid Instagram profile link.", "error");
      return;
    }

    setSaving(true);
    try {
      await updateUserProfile(user.id, {
        displayName: draft.displayName.trim(),
        phoneNumber: draft.phoneNumber.trim(),
        birthDate: draft.birthDate,
        fullAddress: draft.fullAddress.trim(),
        facebookLink: draft.facebookLink.trim(),
        instagramLink: draft.instagramLink.trim(),
      });
      await refreshProfile();
      showToast("Your profile has been updated.", "success");
    } catch {
      showToast("We couldn't update your profile. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="profile-heading">
      <div className={styles.header}>
        <div className={styles.avatar} aria-hidden="true">
          {profile.displayName?.charAt(0).toUpperCase() || "C"}
        </div>
        <div>
          <p className={styles.eyebrow}>CUSTOMER ACCOUNT</p>
          <h1 id="profile-heading" className={styles.heading}>
            My Profile
          </h1>
          <p className={styles.subheading}>
            Keep your contact information current for booking coordination.
          </p>
        </div>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="profile-name">
              Full name<span className={formStyles.required}>*</span>
            </label>
            <input
              id="profile-name"
              className={formStyles.input}
              value={draft.displayName}
              onChange={(event) => updateDraft("displayName", event.target.value)}
              autoComplete="name"
              required
            />
          </div>

          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="profile-email">
              Email address
            </label>
            <input
              id="profile-email"
              className={formStyles.input}
              value={profile.email || user?.email || ""}
              disabled
            />
          </div>
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="profile-phone">
              Phone number<span className={formStyles.required}>*</span>
            </label>
            <input
              id="profile-phone"
              type="tel"
              inputMode="numeric"
              className={formStyles.input}
              value={draft.phoneNumber}
              onChange={(event) => updateDraft("phoneNumber", normalizePhoneInput(event.target.value))}
              autoComplete="tel"
              maxLength={PHONE_DIGIT_COUNT}
              placeholder="09XXXXXXXXX"
              required
            />
            <p className={formStyles.helpText}>Use exactly 11 digits.</p>
          </div>

          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="profile-birth-date">
              Birth date <span className={styles.optional}>(birthday perk)</span>
            </label>
            <input
              id="profile-birth-date"
              type="date"
              className={formStyles.input}
              value={draft.birthDate}
              onChange={(event) => updateDraft("birthDate", event.target.value)}
              max={getMaxBirthDate()}
              disabled={Boolean(profile.birthDate)}
            />
            <p className={styles.fieldNote}>
              {profile.birthDateVerifiedAt
                ? "Verified from your submitted ID. Birthday-month rentals receive ₱100 off."
                : profile.birthDate
                  ? "Saved for verification against your ID. Contact support if it needs correction."
                  : "Add this once to check birthday-month eligibility. It must match your valid ID."}
            </p>
          </div>
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="profile-address">
            Full address<span className={formStyles.required}>*</span>
          </label>
          <textarea
            id="profile-address"
            className={formStyles.textarea}
            value={draft.fullAddress}
            onChange={(event) => updateDraft("fullAddress", event.target.value)}
            autoComplete="street-address"
            required
          />
        </div>

        <div className={formStyles.row}>
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="profile-facebook">
              Facebook profile link<span className={formStyles.required}>*</span>
            </label>
            <input
              id="profile-facebook"
              type="url"
              className={formStyles.input}
              value={draft.facebookLink}
              onChange={(event) => updateDraft("facebookLink", event.target.value)}
              placeholder="https://facebook.com/..."
              required
            />
          </div>

          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="profile-instagram">
              Instagram profile link<span className={formStyles.required}>*</span>
            </label>
            <input
              id="profile-instagram"
              type="url"
              className={formStyles.input}
              value={draft.instagramLink}
              onChange={(event) => updateDraft("instagramLink", event.target.value)}
              placeholder="https://instagram.com/..."
              required
            />
          </div>
        </div>

        <div className={styles.footer}>
          <span className={`${styles.status} ${styles[profile.accountStatus]}`}>
            Account {profile.accountStatus}
          </span>
          <button type="submit" className={formStyles.primaryButton} disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>
        <PushNotificationButton />
      </form>
    </section>
  );
}
