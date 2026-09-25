"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { bookingTrackingPath } from "@/src/lib/bookingAccess";
import { buildCustomerUpdateEmail } from "@/src/lib/customerUpdateEmailContent";
import { formatPeso } from "@/src/lib/emailShell";
import {
  activeCharges,
  CHARGE_TYPE_LABELS,
  computeAmountOwed,
} from "@/src/lib/rentalFulfillment";
import { resendCustomerUpdate, sendCustomerUpdate } from "@/src/services/fulfillmentService";
import type { FulfillmentPanelContext } from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

interface CustomerUpdatesPanelProps {
  ctx: FulfillmentPanelContext;
  initialChargeId?: string;
}

export default function CustomerUpdatesPanel({ ctx, initialChargeId }: CustomerUpdatesPanelProps) {
  const { showToast } = useToast();
  const { updates, charges, adminNames } = ctx.data;
  const owed = computeAmountOwed({ totalAmount: ctx.totalAmount, verifiedPaid: ctx.verifiedPaid, charges });

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [relatedChargeId, setRelatedChargeId] = useState(initialChargeId ?? "");
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const linkable = activeCharges(charges);
  const currentKey = `${subject}\u0000${message}\u0000${relatedChargeId}`;
  const previewing = previewedKey === currentKey && subject.trim() !== "" && message.trim() !== "";
  const hasEmail = ctx.customerEmail.trim() !== "" && ctx.customerEmail !== "-";

  const preview = useMemo(() => {
    if (!previewing) return null;
    const charge = linkable.find((charge) => charge.id === relatedChargeId);
    return buildCustomerUpdateEmail({
      bookingReference: ctx.bookingRef,
      customerName: ctx.customerName,
      subject: subject.trim(),
      message: message.trim(),
      bookingUrl: `${typeof window === "undefined" ? "" : window.location.origin}${bookingTrackingPath(ctx.bookingId, ctx.isGuest)}`,
      isGuest: ctx.isGuest,
      charge: charge
        ? {
            label: CHARGE_TYPE_LABELS[charge.chargeType],
            amount: charge.amount,
            paid: charge.paymentStatus === "paid",
          }
        : undefined,
    });
  }, [previewing, ctx.bookingRef, ctx.customerName, ctx.bookingId, ctx.isGuest, subject, message, relatedChargeId, linkable]);

  function applyTemplate(template: "damage" | "late" | "balance") {
    if (template === "damage") {
      setSubject("Damage found during inspection");
      setMessage("We noticed damage on the item during inspection. Please review the details below.");
    } else if (template === "late") {
      setSubject("Your pickup is late");
      setMessage("Your pickup is late. Please prepare the applicable late fee upon pickup.");
    } else {
      setSubject("Your remaining balance");
      setMessage(`Your remaining balance is ${formatPeso(owed.totalOwed)}.`);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const result = await sendCustomerUpdate(ctx.bookingId, {
        subject: subject.trim(),
        message: message.trim(),
        adminNote: adminNote.trim() || undefined,
        relatedChargeId: relatedChargeId || undefined,
      });
      setSubject("");
      setMessage("");
      setAdminNote("");
      setRelatedChargeId("");
      setPreviewedKey(null);
      await ctx.onChanged();
      showToast(
        result.delivered
          ? `Message sent to ${ctx.customerEmail}.`
          : "The message was saved but could not be emailed. Use Resend in the history below.",
        result.delivered ? "success" : "warning",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The message could not be sent.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function resend(updateId: string) {
    setResendingId(updateId);
    try {
      const result = await resendCustomerUpdate(ctx.bookingId, updateId);
      await ctx.onChanged();
      showToast(
        result.delivered ? "Message sent." : "The message still could not be emailed. Please try again later.",
        result.delivered ? "success" : "warning",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The message could not be sent.", "error");
    } finally {
      setResendingId(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="updates-heading">
      <div className={styles.panelHeader}>
        <h2 id="updates-heading">Customer Updates</h2>
        <p>
          Write a message and email it to {hasEmail ? ctx.customerEmail : "the customer"}. Preview it first. Every message is
          kept in the history below.
        </p>
      </div>

      {!hasEmail ? <p className={styles.noticeWarning}>This booking has no customer email address, so messages cannot be sent.</p> : null}

      <div className={styles.actions} aria-label="Message starters">
        <Button variant="secondary" size="sm" type="button" onClick={() => applyTemplate("damage")} disabled={busy}>Damage notice</Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => applyTemplate("late")} disabled={busy}>Late pickup</Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => applyTemplate("balance")} disabled={busy}>Remaining balance</Button>
      </div>

      <div className={styles.fieldGrid}>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Subject</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={150} disabled={busy} placeholder="What is this about?" />
        </label>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Message to the customer</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} disabled={busy} placeholder="Write in simple, friendly words" />
        </label>
        <label className={styles.field}>
          <span>Related charge (optional)</span>
          <select value={relatedChargeId} onChange={(event) => setRelatedChargeId(event.target.value)} disabled={busy}>
            <option value="">None</option>
            {linkable.map((charge) => (
              <option key={charge.id} value={charge.id}>
                {CHARGE_TYPE_LABELS[charge.chargeType]} · {formatPeso(charge.amount)} ({charge.paymentStatus === "paid" ? "Paid" : "Unpaid"})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Admin note (kept in history, not emailed)</span>
          <input value={adminNote} onChange={(event) => setAdminNote(event.target.value)} maxLength={1000} disabled={busy} />
        </label>
      </div>

      <div className={styles.actions}>
        <Button
          variant="secondary"
          type="button"
          onClick={() => setPreviewedKey(currentKey)}
          disabled={busy || subject.trim() === "" || message.trim() === ""}
        >
          Preview message
        </Button>
        <Button variant="primary" type="button" onClick={() => void send()} disabled={!previewing || !hasEmail} loading={busy} loadingText="Sending...">
          Send to customer
        </Button>
        {!previewing ? <span className={styles.emptyText}>Preview the message before sending.</span> : null}
      </div>

      {preview ? (
        <div>
          <p className={styles.emptyText}>To: {ctx.customerEmail} · Subject: {preview.subject}</p>
          <iframe className={styles.previewFrame} title="Email preview" sandbox="" srcDoc={preview.html} />
        </div>
      ) : null}

      <div className={styles.panelHeader}>
        <h2>Message history</h2>
      </div>
      {updates.length === 0 ? (
        <p className={styles.emptyText}>No messages have been sent yet.</p>
      ) : (
        <ul className={styles.history}>
          {updates.map((update) => {
            const linked = charges.find((charge) => charge.id === update.relatedChargeId);
            return (
              <li key={update.id} className={styles.historyItem}>
                <div className={styles.chargeHead}>
                  <span className={styles.chargeTitle}>{update.subject}</span>
                  <span className={update.deliveryStatus === "sent" ? styles.pillDone : styles.pillPending}>
                    {update.deliveryStatus === "sent" ? "Sent" : "Not sent"}
                  </span>
                </div>
                <p className={styles.chargeMeta}>
                  {update.deliveryStatus === "sent"
                    ? `Sent ${formatDateTime(update.sentAt)} to ${update.sentTo ?? "the customer"}`
                    : `Saved ${formatDateTime(update.createdAt)}. ${update.deliveryAttempts} attempt${update.deliveryAttempts === 1 ? "" : "s"} so far.`}
                  {update.sentBy ? ` By ${adminNames[update.sentBy] ?? "an admin"}.` : ""}
                </p>
                <p>{update.message}</p>
                {linked ? (
                  <p className={styles.chargeMeta}>
                    Related charge: {CHARGE_TYPE_LABELS[linked.chargeType]} · {formatPeso(linked.amount)}
                  </p>
                ) : null}
                {update.adminNote ? <p className={styles.chargeMeta}>Admin note: {update.adminNote}</p> : null}
                {update.deliveryStatus === "failed" ? (
                  <div className={styles.actions}>
                    <Button variant="secondary" size="sm" type="button" onClick={() => void resend(update.id)} loading={resendingId === update.id} loadingText="Sending..." disabled={resendingId !== null || !hasEmail}>
                      Resend
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
