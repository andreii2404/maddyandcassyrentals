"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { fromDateTimeLocalValue, recordReturn, toDateTimeLocalValue } from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext } from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

export default function ReturnPanel({ ctx }: { ctx: FulfillmentPanelContext }) {
  const { showToast } = useToast();
  const record = ctx.data.record;
  const [atValue, setAtValue] = useState(() => toDateTimeLocalValue());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const returned = record?.returned === true;
  const canRecord = ctx.status === "released" && record?.pickedUp === true && !returned;

  async function save() {
    const at = fromDateTimeLocalValue(atValue);
    if (!at) {
      showToast("Enter the actual return date and time.", "warning");
      return;
    }
    setBusy(true);
    try {
      await recordReturn(ctx.bookingId, at, notes);
      await ctx.onChanged();
      showToast("Return recorded.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The return could not be recorded.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="return-heading">
      <div className={styles.panelHeader}>
        <h2 id="return-heading">Return</h2>
        <p>Record when the item came back. The booking stays open until you complete the rental.</p>
      </div>

      {returned ? (
        <>
          <p className={styles.noticeSuccess}>The item has been returned.</p>
          <dl className={styles.facts}>
            <div><dt>Actual return</dt><dd>{formatDateTime(record?.actualReturnAt)}</dd></div>
            <div><dt>Admin notes</dt><dd>{record?.returnNotes || "-"}</dd></div>
          </dl>
        </>
      ) : null}

      {!returned && !canRecord ? (
        <p className={styles.notice}>
          {ctx.status === "returned"
            ? "This rental is completed."
            : "The return can be recorded after the pickup has been recorded."}
        </p>
      ) : null}

      {canRecord ? (
        <>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Actual return date and time</span>
              <input type="datetime-local" value={atValue} onChange={(event) => setAtValue(event.target.value)} disabled={busy} />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Admin notes (optional)</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} disabled={busy} placeholder="Anything worth remembering about the return" />
            </label>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" type="button" onClick={() => void save()} loading={busy} loadingText="Saving...">
              Mark as Returned
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
