"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { MAX_CONDITION_PHOTOS } from "@/src/lib/rentalFulfillment";
import { createClient } from "@/src/lib/supabase/client";
import {
  getConditionPhotoUrl,
  saveItemCondition,
  uploadConditionPhoto,
} from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext, ItemCondition } from "@/src/types/fulfillment";
import styles from "./fulfillment.module.css";

interface ItemConditionPanelProps {
  ctx: FulfillmentPanelContext;
  onOpenCharges: () => void;
}

export default function ItemConditionPanel({ ctx, onOpenCharges }: ItemConditionPanelProps) {
  const { showToast } = useToast();
  const record = ctx.data.record;
  const [condition, setCondition] = useState<ItemCondition | "">(record?.itemCondition ?? "");
  const [notes, setNotes] = useState(record?.conditionNotes ?? "");
  const [photoPaths, setPhotoPaths] = useState<string[]>(record?.conditionPhotoPaths ?? []);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const editable = ctx.status === "released";
  const saved = record?.itemCondition != null;
  const attemptedPaths = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const toAttempt = photoPaths.filter((path) => !photoUrls[path] && !attemptedPaths.current.has(path));
    if (toAttempt.length === 0) return;

    // Mark paths as attempted to prevent retries
    toAttempt.forEach((path) => attemptedPaths.current.add(path));

    const supabase = createClient();
    void Promise.all(
      toAttempt.map(async (path) => {
        try {
          return [path, await getConditionPhotoUrl(supabase, path)] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const resolved = entries.filter((entry) => entry !== null) as Array<[string, string]>;
      // Only update photoUrls if at least one URL resolved
      if (resolved.length > 0) {
        setPhotoUrls((current) => {
          const next = { ...current };
          for (const [path, url] of resolved) next[path] = url;
          return next;
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoPaths]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_CONDITION_PHOTOS - photoPaths.length;
    if (room <= 0) {
      showToast(`You can attach up to ${MAX_CONDITION_PHOTOS} photos.`, "warning");
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        added.push(await uploadConditionPhoto(supabase, ctx.bookingId, file));
      }
      setPhotoPaths((current) => [...current, ...added]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The photo could not be uploaded.", "error");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save() {
    if (!condition) {
      showToast("Choose Good Condition or Has Damage.", "warning");
      return;
    }
    if (condition === "damaged" && !notes.trim()) {
      showToast("Describe the damage in the admin notes.", "warning");
      return;
    }
    setBusy(true);
    try {
      await saveItemCondition(ctx.bookingId, { condition, notes, photoPaths });
      await ctx.onChanged();
      showToast("Item condition saved.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The item condition could not be saved.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="condition-heading">
      <div className={styles.panelHeader}>
        <h2 id="condition-heading">Item Condition</h2>
        <p>Check the item when it comes back and note anything the customer should know.</p>
      </div>

      {!editable && !saved ? (
        <p className={styles.notice}>
          {ctx.status === "returned"
            ? "This rental is completed. No condition was recorded."
            : "The item condition can be recorded after the item has been picked up."}
        </p>
      ) : null}

      {editable || saved ? (
        <>
          <fieldset className={styles.field} disabled={!editable || busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Condition</legend>
            <label>
              <input type="radio" name="item-condition" checked={condition === "good"} onChange={() => setCondition("good")} /> Good Condition
            </label>
            <label>
              <input type="radio" name="item-condition" checked={condition === "damaged"} onChange={() => setCondition("damaged")} /> Has Damage
            </label>
          </fieldset>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Admin notes{condition === "damaged" ? " (required)" : " (optional)"}</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} disabled={!editable || busy} placeholder="Describe what you found" />
          </label>

          <div className={styles.field}>
            <span>Photos (optional, up to {MAX_CONDITION_PHOTOS})</span>
            {photoPaths.length ? (
              <div className={styles.photoGrid}>
                {photoPaths.map((path) => (
                  <div key={path} className={styles.photoThumb}>
                    {photoUrls[path] ? (
                      // Private signed URL; next/image cannot optimize it.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photoUrls[path]} alt="Item condition photo" />
                    ) : (
                      <p className={styles.emptyText}>Loading photo...</p>
                    )}
                    {editable ? (
                      <button type="button" onClick={() => setPhotoPaths((current) => current.filter((item) => item !== path))} disabled={busy}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>No photos added.</p>
            )}
            {editable ? (
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy || uploading || photoPaths.length >= MAX_CONDITION_PHOTOS}
                onChange={(event) => void handleFiles(event.target.files)}
              />
            ) : null}
          </div>

          {editable ? (
            <div className={styles.actions}>
              <Button variant="primary" type="button" onClick={() => void save()} loading={busy || uploading} loadingText={uploading ? "Uploading..." : "Saving..."}>
                Save condition
              </Button>
            </div>
          ) : null}

          {saved && record?.itemCondition === "damaged" ? (
            <p className={styles.noticeWarning}>
              Damage was recorded. If a fee applies, add it yourself in Charges &amp; Payments.{" "}
              <Button variant="none" type="button" onClick={onOpenCharges}>Open Charges &amp; Payments</Button>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
