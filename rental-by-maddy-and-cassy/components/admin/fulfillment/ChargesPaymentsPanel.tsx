"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";
import {
  CHARGE_METHOD_LABELS,
  CHARGE_TYPE_LABELS,
  computeAmountOwed,
  formatPhp,
} from "@/src/lib/rentalFulfillment";
import {
  addCharge,
  fromDateTimeLocalValue,
  markChargePaid,
  toDateTimeLocalValue,
  voidCharge,
} from "@/src/services/fulfillmentService";
import type {
  BookingCharge,
  ChargePaymentMethod,
  ChargeType,
  FulfillmentPanelContext,
} from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

interface ChargesPaymentsPanelProps {
  ctx: FulfillmentPanelContext;
}

const ADD_ALLOWED_STATUSES = ["confirmed", "ready_for_release", "released"];
const CLOSED_STATUSES = ["returned", "cancelled", "rejected"];

export default function ChargesPaymentsPanel({ ctx }: ChargesPaymentsPanelProps) {
  const { showToast } = useToast();
  const { charges, adminNames } = ctx.data;
  const owed = computeAmountOwed({ totalAmount: ctx.totalAmount, verifiedPaid: ctx.verifiedPaid, charges });

  const [chargeType, setChargeType] = useState<ChargeType>("late_fee");
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [payTarget, setPayTarget] = useState<BookingCharge | null>(null);
  const [payMethod, setPayMethod] = useState<ChargePaymentMethod>("cash");
  const [paidAtValue, setPaidAtValue] = useState("");
  const [voidTarget, setVoidTarget] = useState<BookingCharge | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const canAdd = ADD_ALLOWED_STATUSES.includes(ctx.status);
  const canChange = !CLOSED_STATUSES.includes(ctx.status);
  const nameOf = (id?: string) => (id ? adminNames[id] ?? "an admin" : "an admin");

  async function run(action: () => Promise<void>, success: string, fallback: string) {
    setBusy(true);
    try {
      await action();
      await ctx.onChanged();
      showToast(success, "success");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : fallback, "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter an amount greater than zero.", "warning");
      return;
    }
    if (reason.trim().length < 3) {
      showToast("Add a short reason for the charge.", "warning");
      return;
    }
    const ok = await run(
      async () => {
        await addCharge(ctx.bookingId, { chargeType, amount, reason: reason.trim() });
      },
      "Charge added.",
      "The charge could not be added.",
    );
    if (ok) {
      setAmountText("");
      setReason("");
    }
  }

  async function handleMarkPaid() {
    if (!payTarget) return;
    const paidAt = fromDateTimeLocalValue(paidAtValue);
    if (!paidAt) {
      showToast("Enter the date and time the payment was received.", "warning");
      return;
    }
    const target = payTarget;
    const ok = await run(
      () => markChargePaid(ctx.bookingId, target.id, { method: payMethod, paidAt }),
      "Charge marked as paid.",
      "The charge could not be updated.",
    );
    if (ok) setPayTarget(null);
  }

  async function handleVoid() {
    if (!voidTarget) return;
    const target = voidTarget;
    const ok = await run(
      () => voidCharge(ctx.bookingId, target.id, voidReason.trim()),
      "Charge voided.",
      "The charge could not be voided.",
    );
    if (ok) {
      setVoidTarget(null);
      setVoidReason("");
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="charges-heading">
      <div className={styles.panelHeader}>
        <h2 id="charges-heading">Charges &amp; Payments</h2>
        <p>See at a glance whether the customer still owes anything. You type every fee yourself.</p>
      </div>

      <div className={owed.totalOwed > 0 ? styles.owedSummary : `${styles.owedSummary} ${styles.owedSummaryClear}`}>
        {owed.totalOwed > 0 ? (
          <>
            <strong>Customer still owes {formatPhp(owed.totalOwed)}</strong>
            <span>
              {owed.bookingBalance > 0 ? `Booking balance ${formatPhp(owed.bookingBalance)}` : "Booking balance paid"}
              {owed.unpaidCharges > 0 ? ` · Unpaid extra charges ${formatPhp(owed.unpaidCharges)}` : ""}
            </span>
          </>
        ) : (
          <>
            <strong>Nothing owed. Fully paid.</strong>
            <span>The booking and all extra charges are settled.</span>
          </>
        )}
      </div>

      <dl className={styles.facts}>
        <div><dt>Booking total</dt><dd>{formatPhp(ctx.totalAmount)}</dd></div>
        <div><dt>Verified payments</dt><dd>{formatPhp(ctx.verifiedPaid)}</dd></div>
        <div><dt>Remaining balance</dt><dd>{formatPhp(owed.bookingBalance)}</dd></div>
        {ctx.payLaterAllowed ? <div><dt>Pay-later exception</dt><dd>Approved</dd></div> : null}
      </dl>

      {ctx.pendingPaymentReviews > 0 ? (
        <p className={styles.noticeWarning}>
          {ctx.pendingPaymentReviews} payment proof{ctx.pendingPaymentReviews === 1 ? " is" : "s are"} waiting for review in the
          follow-up list above.
        </p>
      ) : null}

      <div className={styles.panelHeader}>
        <h2>Extra charges</h2>
      </div>

      {charges.length === 0 ? (
        <p className={styles.emptyText}>No extra charges have been added.</p>
      ) : (
        <ul className={styles.chargeList}>
          {charges.map((charge) => {
            const voided = Boolean(charge.voidedAt);
            return (
              <li key={charge.id} className={`${styles.chargeCard} ${voided ? styles.chargeVoided : ""}`}>
                <div className={styles.chargeHead}>
                  <span className={styles.chargeTitle}>
                    {CHARGE_TYPE_LABELS[charge.chargeType]} · {formatPhp(charge.amount)}
                  </span>
                  <span className={voided ? styles.pill : charge.paymentStatus === "paid" ? styles.pillDone : styles.pillPending}>
                    {voided ? "Voided" : charge.paymentStatus === "paid" ? "Paid" : "Unpaid"}
                  </span>
                </div>
                <p className={styles.chargeMeta}>Reason: {charge.reason}</p>
                <p className={styles.chargeMeta}>
                  Added by {nameOf(charge.createdBy)} on {formatDateTime(charge.createdAt)}
                </p>
                {charge.paymentStatus === "paid" ? (
                  <p className={styles.chargeMeta}>
                    Paid by {charge.paymentMethod ? CHARGE_METHOD_LABELS[charge.paymentMethod] : "-"} on{" "}
                    {formatDateTime(charge.paidAt)}. Recorded by {nameOf(charge.paidRecordedBy)}.
                  </p>
                ) : null}
                {voided ? (
                  <p className={styles.chargeMeta}>
                    Voided by {nameOf(charge.voidedBy)} on {formatDateTime(charge.voidedAt)}. Reason: {charge.voidReason}
                  </p>
                ) : null}
                {!voided && canChange ? (
                  <div className={styles.actions}>
                    {charge.paymentStatus === "unpaid" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setPayMethod("cash");
                          setPaidAtValue(toDateTimeLocalValue());
                          setPayTarget(charge);
                        }}
                      >
                        Mark as paid
                      </Button>
                    ) : null}
                    <Button variant="danger" size="sm" type="button" disabled={busy} onClick={() => { setVoidReason(""); setVoidTarget(charge); }}>
                      Void
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.panelHeader}>
        <h2>Add a charge</h2>
        <p>Enter the exact amount. Nothing is filled in for you.</p>
      </div>
      {canAdd ? (
        <>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Charge type</span>
              <select value={chargeType} onChange={(event) => setChargeType(event.target.value as ChargeType)} disabled={busy}>
                {(Object.keys(CHARGE_TYPE_LABELS) as ChargeType[]).map((type) => (
                  <option key={type} value={type}>{CHARGE_TYPE_LABELS[type]}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Amount (PHP)</span>
              <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amountText} onChange={(event) => setAmountText(event.target.value)} disabled={busy} />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`}>
              <span>Reason / admin note</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} disabled={busy} placeholder="For example: returned 3 hours after the agreed time" />
            </label>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" type="button" onClick={() => void handleAdd()} loading={busy} loadingText="Saving...">
              Add charge
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.notice}>Charges can be added once the booking is confirmed and until it is completed.</p>
      )}

      {payTarget ? (
        <ConfirmModal
          title="Mark charge as paid"
          description={`Record that ${formatPhp(payTarget.amount)} for the ${CHARGE_TYPE_LABELS[payTarget.chargeType].toLowerCase()} was received.`}
          confirmLabel="Mark as paid"
          busyLabel="Saving..."
          onCancel={() => setPayTarget(null)}
          onConfirm={() => void handleMarkPaid()}
          busy={busy}
        >
          <label>
            <span>Payment method</span>
            <select value={payMethod} onChange={(event) => setPayMethod(event.target.value as ChargePaymentMethod)} disabled={busy}>
              {(Object.keys(CHARGE_METHOD_LABELS) as ChargePaymentMethod[]).map((method) => (
                <option key={method} value={method}>{CHARGE_METHOD_LABELS[method]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Date and time received</span>
            <input type="datetime-local" value={paidAtValue} onChange={(event) => setPaidAtValue(event.target.value)} disabled={busy} />
          </label>
        </ConfirmModal>
      ) : null}

      {voidTarget ? (
        <ConfirmModal
          title="Void this charge?"
          description={
            voidTarget.paymentStatus === "paid"
              ? "This charge was already marked as paid. Voiding keeps the record but it will no longer count. Handle any refund with the customer yourself."
              : "The charge stays on record but no longer counts toward what the customer owes."
          }
          confirmLabel="Void charge"
          busyLabel="Saving..."
          tone="danger"
          onCancel={() => setVoidTarget(null)}
          onConfirm={() => void handleVoid()}
          confirmDisabled={voidReason.trim().length < 3}
          busy={busy}
        >
          <label>
            <span>Reason for voiding (required)</span>
            <textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} rows={3} maxLength={500} disabled={busy} />
          </label>
        </ConfirmModal>
      ) : null}
    </section>
  );
}
