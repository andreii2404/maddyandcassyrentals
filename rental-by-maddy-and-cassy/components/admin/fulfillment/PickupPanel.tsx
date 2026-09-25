"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";
import { fromDateTimeLocalValue, recordPickup, toDateTimeLocalValue } from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext } from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

interface PickupPanelProps {
  ctx: FulfillmentPanelContext;
  onOpenCharges: () => void;
  onRequestCancel?: () => void;
}

export default function PickupPanel({ ctx, onOpenCharges, onRequestCancel }: PickupPanelProps) {
  const { showToast } = useToast();
  const record = ctx.data.record;
  const [atValue, setAtValue] = useState(() => toDateTimeLocalValue(ctx.releasedAt));
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pickedUp = record?.pickedUp === true;
  const readyForPickup = ctx.status === "ready_for_release";
  // Released before this feature existed: only the pickup details are missing.
  const missingDetails = ctx.status === "released" && !pickedUp;
  const canRecord = readyForPickup || missingDetails;
  const canCancel = ["approved", "confirmed", "ready_for_release"].includes(ctx.status);
  const blockedByBalance = readyForPickup && !ctx.handoverPaymentReady;

  async function save() {
    const at = fromDateTimeLocalValue(atValue);
    if (!at) {
      showToast("Enter the actual pickup date and time.", "warning");
      setConfirmOpen(false);
      return;
    }
    setBusy(true);
    try {
      await recordPickup(ctx.bookingId, at, notes);
      await ctx.onChanged();
      setConfirmOpen(false);
      showToast(readyForPickup ? "Pickup recorded. The customer was notified." : "Pickup details saved.", "success");
    } catch (error) {
      setConfirmOpen(false);
      showToast(error instanceof Error ? error.message : "The pickup could not be recorded.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="pickup-heading">
      <div className={styles.panelHeader}>
        <h2 id="pickup-heading">Pickup</h2>
        <p>Record when the customer received the item.</p>
      </div>

      {pickedUp ? (
        <>
          <p className={styles.noticeSuccess}>The customer has picked up the item.</p>
          <dl className={styles.facts}>
            <div><dt>Actual pickup</dt><dd>{formatDateTime(record?.actualPickupAt)}</dd></div>
            <div><dt>Admin notes</dt><dd>{record?.pickupNotes || "-"}</dd></div>
          </dl>
        </>
      ) : null}

      {!pickedUp && !canRecord ? (
        <p className={styles.notice}>
          {ctx.status === "returned"
            ? "This rental is completed. No pickup was recorded."
            : "Pickup can be recorded once the booking is Ready for Handover. Finish the follow-up items above first."}
        </p>
      ) : null}

      {canRecord ? (
        <>
          {blockedByBalance ? (
            <p className={styles.noticeWarning}>
              The remaining balance must be settled before pickup can be confirmed.{" "}
              <Button variant="none" type="button" onClick={onOpenCharges}>See Charges &amp; Payments</Button>
            </p>
          ) : null}
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Actual pickup date and time</span>
              <input type="datetime-local" value={atValue} onChange={(event) => setAtValue(event.target.value)} disabled={busy} />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Admin notes (optional)</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} disabled={busy} placeholder="Who collected the item, what was handed over" />
            </label>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" type="button" onClick={() => setConfirmOpen(true)} disabled={busy || blockedByBalance}>
              {readyForPickup ? "Mark as Picked Up" : "Save pickup details"}
            </Button>
          </div>
        </>
      ) : null}

      {canCancel && onRequestCancel ? (
        <div className={styles.actions}>
          <Button variant="danger" type="button" onClick={onRequestCancel}>Cancel Booking</Button>
        </div>
      ) : null}

      {confirmOpen ? (
        <ConfirmModal
          title={readyForPickup ? "Mark as Picked Up?" : "Save pickup details?"}
          description={readyForPickup
            ? `Confirm that the customer picked up the item for booking ${ctx.bookingRef}. The booking will be marked as released to the customer.`
            : `Save the pickup details for booking ${ctx.bookingRef}.`}
          confirmLabel={readyForPickup ? "Yes, Mark as Picked Up" : "Save"}
          busyLabel="Saving..."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void save()}
          busy={busy}
        />
      ) : null}
    </section>
  );
}
