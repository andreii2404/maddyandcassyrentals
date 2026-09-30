"use client";

import { useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { updateUserProfile } from "@/src/services/userService";
import type { UserProfile } from "@/src/types/database";
import { useToast } from "@/components/ui/ToastProvider";
import { Button } from "@/components/ui/Button";
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
    if (!user || saving) return;

    if (draft.displayName.trim().length < 2) {
      showToast("Please enter your full name.", "warning");
      return;
    }

    if (!isValidPhoneNumber(draft.phoneNumber)) {
      showToast(`Phone number must contain exactly ${PHONE_DIGIT_COUNT} digits.`, "warning");
      return;
    }

    if (draft.birthDate && new Date(`${draft.birthDate}T00:00:00`) > new Date()) {
      showToast("Birth date cannot be in the future.", "warning");
      return;
    }

    if (draft.birthDate && !isAtLeastMinimumAge(draft.birthDate)) {
      showToast(UNDERAGE_ERROR_MESSAGE, "warning");
      return;
    }

    if (!draft.fullAddress.trim()) {
      showToast("Full address is required.", "warning");
      return;
    }

    if (!isValidProfileUrl(draft.facebookLink.trim(), ["facebook.com", "fb.com"])) {
      showToast("Enter a valid Facebook profile link.", "warning");
      return;
    }

    if (!isValidProfileUrl(draft.instagramLink.trim(), ["instagram.com"])) {
      showToast("Enter a valid Instagram profile link.", "warning");
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

  const birthDateLocked = Boolean(profile.birthDate);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.avatar} aria-hidden="true">
          {profile.displayName?.charAt(0).toUpperCase() || "C"}
        </div>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>Customer account</p>
          <h1 id="profile-heading" className={styles.heading}>
            My Profile
          </h1>
          <p className={styles.subheading}>
            Keep your contact information current for booking coordination.
          </p>
        </div>
        <span className={`${styles.status} ${styles[profile.accountStatus]}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          Account {profile.accountStatus}
        </span>
      </header>

      <form className={styles.form} onSubmit={handleSubmit} aria-labelledby="profile-heading">
        <section className={styles.section} aria-labelledby="profile-personal-heading">
          <div className={styles.sectionIntro}>
            <h2 id="profile-personal-heading" className={styles.sectionTitle}>
              Personal Information
            </h2>
            <p className={styles.sectionDescription}>Your name and account identity.</p>
          </div>

          <div className={styles.sectionFields}>
            <div className={formStyles.field}>
              <label className={styles.label} htmlFor="profile-name">
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

            <div className={formStyles.row}>
              <div className={formStyles.field}>
                <label className={styles.label} htmlFor="profile-email">
                  Email address
                  <span className={styles.lockedBadge}>Read-only</span>
                </label>
                <input
                  id="profile-email"
                  className={`${formStyles.input} ${styles.lockedInput}`}
                  value={profile.email || user?.email || ""}
                  disabled
                />
              </div>

              <div className={formStyles.field}>
                <label className={styles.label} htmlFor="profile-birth-date">
                  Birth date <span className={styles.optional}>(birthday perk)</span>
                  {birthDateLocked ? <span className={styles.lockedBadge}>Locked</span> : null}
                </label>
                <input
                  id="profile-birth-date"
                  type="date"
                  className={`${formStyles.input} ${birthDateLocked ? styles.lockedInput : ""}`}
                  value={draft.birthDate}
                  onChange={(event) => updateDraft("birthDate", event.target.value)}
                  max={getMaxBirthDate()}
                  disabled={birthDateLocked}
                  aria-describedby="profile-birth-date-note"
                />
              </div>
            </div>
            <p id="profile-birth-date-note" className={styles.fieldNote}>
              {profile.birthDateVerifiedAt
                ? "Verified from your submitted ID. Birthday-month rentals receive ₱100 off."
                : profile.birthDate
                  ? "Saved for verification against your ID. Contact support if it needs correction."
                  : "Add this once to check birthday-month eligibility. It must match your valid ID."}
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="profile-contact-heading">
          <div className={styles.sectionIntro}>
            <h2 id="profile-contact-heading" className={styles.sectionTitle}>
              Contact &amp; Address
            </h2>
            <p className={styles.sectionDescription}>
              Used to coordinate pickups, returns, and booking updates.
            </p>
          </div>

          <div className={styles.sectionFields}>
            <div className={`${formStyles.field} ${styles.phoneField}`}>
              <label className={styles.label} htmlFor="profile-phone">
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
              <label className={styles.label} htmlFor="profile-address">
                Full address<span className={formStyles.required}>*</span>
              </label>
              <textarea
                id="profile-address"
                className={`${formStyles.textarea} ${styles.addressInput}`}
                value={draft.fullAddress}
                onChange={(event) => updateDraft("fullAddress", event.target.value)}
                autoComplete="street-address"
                required
              />
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="profile-social-heading">
          <div className={styles.sectionIntro}>
            <h2 id="profile-social-heading" className={styles.sectionTitle}>
              Social Profiles
            </h2>
            <p className={styles.sectionDescription}>
              Helps us confirm who we are renting to.
            </p>
          </div>

          <div className={styles.sectionFields}>
            <div className={formStyles.field}>
              <label className={styles.label} htmlFor="profile-facebook">
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
              <label className={styles.label} htmlFor="profile-instagram">
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
        </section>

        <div className={styles.actions}>
          <p className={styles.actionsHint}>
            Fields marked <span className={formStyles.required}>*</span> are required.
          </p>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className={styles.saveButton}
            loading={saving}
            loadingText="Saving..."
            disabled={saving}
          >
            Save Profile
          </Button>
        </div>
      </form>

      <section className={styles.section} aria-labelledby="profile-notifications-heading">
        <div className={styles.sectionIntro}>
          <h2 id="profile-notifications-heading" className={styles.sectionTitle}>
            Notifications
          </h2>
          <p className={styles.sectionDescription}>Applies to this device only.</p>
        </div>

        <div className={styles.sectionFields}>
          <PushNotificationButton />
        </div>
      </section>
    </div>
  );
}
