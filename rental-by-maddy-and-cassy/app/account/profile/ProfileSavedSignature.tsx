"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { loadSavedSignature, saveSavedSignature } from "@/src/services/savedSignatureService";
import { validateSavedSignatureFile } from "@/src/lib/savedSignature";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./profile.module.css";

export default function ProfileSavedSignature() {
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const changedLocallyRef = useRef(false);

  useEffect(() => {
    let active = true;
    void loadSavedSignature()
      .then((dataUrl) => { if (active && !changedLocallyRef.current) setPreview(dataUrl); })
      .catch(() => { if (active && !changedLocallyRef.current) setMessage("Your saved signature could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || saving) return;
    changedLocallyRef.current = true;
    setLoading(false);
    const error = validateSavedSignatureFile(file);
    if (error) {
      setMessage(error);
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await saveSavedSignature(file);
      setPreview(await loadSavedSignature());
      setMessage("Signature saved for future rental agreements.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Your signature could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="profile-signature-heading">
      <div className={styles.sectionIntro}>
        <h2 id="profile-signature-heading" className={styles.sectionTitle}>Saved Signature</h2>
        <p className={styles.sectionDescription}>
          Your uploaded signature appears automatically on future rental agreements. You can replace it here anytime.
        </p>
      </div>
      <div className={styles.sectionFields}>
        {loading ? <p className={styles.fieldNote}>Loading signature…</p> : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.signaturePreview} src={preview} alt="Your saved signature" />
        ) : <p className={styles.fieldNote}>No signature saved yet.</p>}
        <div className={formStyles.field}>
          <label className={styles.label} htmlFor="profile-signature-file">
            {preview ? "Replace saved signature" : "Upload a signature image"}
          </label>
          <input
            id="profile-signature-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void handleFileChange(event)}
            disabled={saving}
          />
          <p className={styles.fieldNote}>PNG, JPEG, or WebP; 4 MB maximum.</p>
        </div>
        {saving ? <p className={styles.fieldNote} role="status">Saving signature…</p> : null}
        {message ? <p className={styles.fieldNote} role="status">{message}</p> : null}
      </div>
    </section>
  );
}
