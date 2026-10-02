"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";
import { REFERENCE_NUMBER_MAX_LENGTH, sanitizeReferenceNumberInput } from "@/src/lib/paymentValidation";
import {
  DEPOSIT_METHOD_LABELS,
  formatPhp,
  SECURITY_DEPOSIT_AMOUNT,
  validateSecurityDepositInput,
} from "@/src/lib/rentalFulfillment";
import { fromDateTimeLocalValue, recordSecurityDeposit, toDateTimeLocalValue } from "@/src/services/fulfillmentService";
import type { DepositPaymentMethod, FulfillmentPanelContext } from "@/src/types/fulfillment";
import { formatDateTime } from "./format";
import styles from "./fulfillment.module.css";

const METHODS: DepositPaymentMethod[] = ["gcash", "maya", "bank_transfer", "cash"];

export default function SecurityDepositPanel({ ctx }: { ctx: FulfillmentPanelContext }) {
  const { showToast } = useToast();
  const { record, securityDeposit: deposit, securityDepositAvailable, adminNames } = ctx.data;
  const [method, setMethod] = useState<DepositPaymentMethod | null>(null);
  const [reference, setReference] = useState("");
  const [paidAtValue, setPaidAtValue] = useState(() => toDateTimeLocalValue());
  const [attempted, setAttempted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const amountLabel = formatPhp(deposit?.amount ?? SECURITY_DEPOSIT_AMOUNT);
  const canRecord = !deposit && securityDepositAvailable && ctx.status === "released" && record?.pickedUp === true;
  const digitalMethod = method !== null && method !== "cash" ? method : null;
  const methodError = attempted && !method ? "Choose how the deposit was paid." : null;
  const referenceError = attempted && digitalMethod
    ? validateSecurityDepositInput({ method: digitalMethod, referenceNumber: reference })
    : null;
  const paidAt = fromDateTimeLocalValue(paidAtValue);
  const dateError = attempted && !paidAt ? "Enter the date and time the deposit was received." : null;

  function review() {
    setAttempted(true);
    if (!method || validateSecurityDepositInput({ method, referenceNumber: reference }) || !paidAt) return;
    setConfirmOpen(true);
  }

  async function save() {
    if (!method || !paidAt) return;
    setBusy(true);
    try {
      await recordSecurityDeposit(ctx.bookingId, {
        method,
        referenceNumber: method === "cash" ? "" : reference.trim(),
        paidAt,
      });
      setConfirmOpen(false);
      await ctx.onChanged();
      showToast("Security deposit recorded as paid.", "success");
    } catch (error) {
      setConfirmOpen(false);
      showToast(error instanceof Error ? error.message : "The security deposit could not be saved.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="deposit-heading">
      <div className={styles.panelHeader}>
        <h2 id="deposit-heading">Security Deposit</h2>
        <p>
          Collect a refundable {formatPhp(SECURITY_DEPOSIT_AMOUNT)} deposit after pickup. The booking cannot move
          forward until it is recorded as paid.
        </p>
      </div>

      {deposit ? (
        <>
          <div className={`${styles.depositAmount} ${styles.depositAmountPaid}`}>
            <div>
              <span className={styles.depositAmountLabel}>Security deposit</span>
              <strong>{amountLabel}</strong>
            </div>
            <span className={styles.pillDone}>Paid</span>
          </div>
          <dl className={styles.facts}>
            <div><dt>Payment method</dt><dd>{DEPOSIT_METHOD_LABELS[deposit.paymentMethod] ?? deposit.paymentMethod}</dd></div>
            <div><dt>Reference number</dt><dd>{deposit.referenceNumber ?? "Not required (Cash)"}</dd></div>
            <div><dt>Received</dt><dd>{formatDateTime(deposit.paidAt)}</dd></div>
            <div>
              <dt>Recorded by</dt>
              <dd>{deposit.recordedBy ? adminNames[deposit.recordedBy] ?? "An admin" : "An admin"}</dd>
            </div>
            <div><dt>Recorded on</dt><dd>{formatDateTime(deposit.recordedAt)}</dd></div>
          </dl>
          {record?.itemCondition === "good" ? (
            <p className={styles.noticeSuccess}>
              The returned item passed inspection. The {amountLabel} deposit can now be refunded to the customer.
            </p>
          ) : record?.itemCondition === "damaged" ? (
            <p className={styles.noticeWarning}>
              Damage was recorded on the returned item. Review the damage and any charges before refunding the deposit.
            </p>
          ) : (
            <p className={styles.notice}>This deposit is refundable after the returned item passes inspection.</p>
          )}
        </>
      ) : null}

      {!deposit && !securityDepositAvailable ? (
        <p className={styles.noticeWarning}>
          Security deposit records are unavailable. The database update for this feature must be applied before the
          deposit can be recorded.
        </p>
      ) : null}

      {!deposit && securityDepositAvailable && !canRecord ? (
        <p className={styles.notice}>
          {ctx.status === "returned"
            ? "This rental is completed. No security deposit was recorded."
            : "The security deposit can be recorded after the pickup is recorded."}
        </p>
      ) : null}

      {canRecord ? (
        <>
          <p className={styles.noticeWarning}>
            Required: Return and Complete Rental stay locked until this deposit is marked as paid.
          </p>

          <div className={styles.depositAmount}>
            <div>
              <span className={styles.depositAmountLabel}>Amount to collect</span>
              <strong>{amountLabel}</strong>
            </div>
            <span className={styles.depositAmountNote}>Fixed amount · Refundable after inspection</span>
          </div>

          <fieldset className={styles.methodGroup} aria-describedby={methodError ? "deposit-method-error" : undefined}>
            <legend>Payment method</legend>
            <div className={styles.methodOptions}>
              {METHODS.map((option) => (
                <label key={option} className={styles.methodOption}>
                  <input
                    type="radio"
                    name="deposit-method"
                    value={option}
                    checked={method === option}
                    onChange={() => setMethod(option)}
                    disabled={busy}
                  />
                  <span className={styles.methodCard}>
                    <span className={styles.methodDot} aria-hidden="true" />
                    <span className={styles.methodText}>
                      <span className={styles.methodName}>{DEPOSIT_METHOD_LABELS[option]}</span>
                      <span className={styles.methodHint}>
                        {option === "cash" ? "No reference number" : "Reference number required"}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {methodError ? <span id="deposit-method-error" className={styles.fieldError}>{methodError}</span> : null}
          </fieldset>

          <div className={styles.fieldGrid}>
            {digitalMethod ? (
              <label className={styles.field}>
                <span>{DEPOSIT_METHOD_LABELS[digitalMethod]} reference number</span>
                <input
                  type="text"
                  value={reference}
                  onChange={(event) => setReference(sanitizeReferenceNumberInput(event.target.value))}
                  maxLength={REFERENCE_NUMBER_MAX_LENGTH}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  aria-invalid={referenceError ? true : undefined}
                  aria-describedby={referenceError ? "deposit-reference-error" : "deposit-reference-hint"}
                  disabled={busy}
                  placeholder="For example: 1234567890123"
                />
                {referenceError ? (
                  <span id="deposit-reference-error" className={styles.fieldError}>{referenceError}</span>
                ) : (
                  <span id="deposit-reference-hint" className={styles.fieldHint}>Letters, numbers and dashes only.</span>
                )}
              </label>
            ) : null}
            <label className={styles.field}>
              <span>Date and time received</span>
              <input
                type="datetime-local"
                value={paidAtValue}
                onChange={(event) => setPaidAtValue(event.target.value)}
                aria-invalid={dateError ? true : undefined}
                aria-describedby={dateError ? "deposit-date-error" : undefined}
                disabled={busy}
              />
              {dateError ? <span id="deposit-date-error" className={styles.fieldError}>{dateError}</span> : null}
            </label>
          </div>

          {method === "cash" ? (
            <p className={styles.notice}>Cash payment: no reference number is needed. It will be recorded as Cash.</p>
          ) : null}

          <div className={styles.actions}>
            <Button variant="primary" type="button" onClick={review} disabled={busy}>
              Mark Deposit as Paid
            </Button>
          </div>
        </>
      ) : null}

      {confirmOpen && method && paidAt ? (
        <ConfirmModal
          title="Mark security deposit as paid?"
          description={`Record that the ${amountLabel} security deposit for booking ${ctx.bookingRef} was paid by ${DEPOSIT_METHOD_LABELS[method]}${
            method === "cash" ? "" : ` (reference ${reference.trim()})`
          } on ${formatDateTime(paidAt)}. Check the details first: the deposit record cannot be edited after saving.`}
          confirmLabel="Yes, Mark as Paid"
          busyLabel="Saving..."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void save()}
          busy={busy}
        />
      ) : null}
    </section>
  );
}
