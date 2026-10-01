"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import StatusBadge from "@/components/status-badge/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import {
  BOOKING_REFERENCE_MAX_LENGTH,
  BOOKING_REFERENCE_NOT_FOUND_MESSAGE,
  BOOKING_REFERENCE_PLACEHOLDER,
  isValidBookingReference,
  normalizeBookingReference,
  type PublicBookingTracking,
  type TrackingStep,
} from "@/src/lib/bookingLookup";
import styles from "./TrackBookingModal.module.css";

interface TrackBookingModalProps {
  onClose: () => void;
}

const NETWORK_ERROR = "We couldn't reach the booking service. Check your connection and try again.";
const ACCOUNT_BOOKINGS_SIGN_IN = `/sign-in?redirect=${encodeURIComponent("/account/bookings")}`;

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

const STEP_STATE_TEXT: Record<TrackingStep["state"], string> = {
  complete: "Completed",
  current: "In progress",
  upcoming: "Upcoming",
  closed: "Closed",
};

// Plain-language badge wording for customers; other statuses keep StatusBadge's default label.
const TRACKING_BADGE_LABELS: Partial<Record<PublicBookingTracking["status"], string>> = {
  pending: "Pending Review",
};

function StepMarker({ state }: { state: TrackingStep["state"] }) {
  return (
    <span className={`${styles.marker} ${styles[`marker_${state}`]}`} aria-hidden="true">
      {state === "complete" ? <CheckIcon /> : state === "closed" ? <CloseIcon /> : null}
    </span>
  );
}

function itemLabel(item: PublicBookingTracking["items"][number]): string {
  const name = item.variant ? `${item.name} (${item.variant})` : item.name;
  return item.quantity > 1 ? `${name} × ${item.quantity}` : name;
}

/**
 * Track Booking: a parcel-style "track & trace" lookup. Anyone with a booking
 * reference sees its public progress; documents, payments, and account-only
 * actions stay behind the booking owner's sign-in.
 */
export default function TrackBookingModal({ onClose }: TrackBookingModalProps) {
  const { user } = useAuth();
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicBookingTracking | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const descriptionId = useId();
  const referenceId = useId();
  const referenceHintId = useId();
  const errorId = useId();
  const resultHeadingId = useId();

  // Modal focuses its dialog after mount; move focus to the field next.
  useEffect(() => {
    const timer = window.setTimeout(() => referenceInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Announce a new result by moving focus to its status heading.
  useEffect(() => {
    if (result) resultHeadingRef.current?.focus();
  }, [result]);

  async function trackBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalized = normalizeBookingReference(reference);
    setReference(normalized);
    setResult(null);
    if (!normalized) {
      setError("Enter your booking reference.");
      referenceInputRef.current?.focus();
      return;
    }
    if (!isValidBookingReference(normalized)) {
      setError(BOOKING_REFERENCE_NOT_FOUND_MESSAGE);
      referenceInputRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/bookings/lookup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingReference: normalized }),
      });
      const body = (await response.json().catch(() => null)) as
        | (Partial<PublicBookingTracking> & { error?: unknown })
        | null;
      if (response.ok && body && typeof body.bookingReference === "string" && Array.isArray(body.steps)) {
        setResult(body as PublicBookingTracking);
        return;
      }
      setError(
        response.status === 404
          ? BOOKING_REFERENCE_NOT_FOUND_MESSAGE
          : typeof body?.error === "string"
            ? body.error
            : "We couldn't track that booking right now. Please try again.",
      );
      referenceInputRef.current?.focus();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const isAccountHolder = Boolean(user) && !user?.is_anonymous;
  const handoverLabel = result?.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup";

  return (
    <Modal title="Track Booking" onClose={() => { if (!busy) onClose(); }} describedBy={descriptionId} size="medium">
      <div className={styles.body}>
        <form className={styles.searchForm} onSubmit={trackBooking} noValidate>
          <p id={descriptionId} className={styles.intro}>
            Enter your booking reference to see the latest status of your rental.
          </p>
          <div className={styles.field}>
            <label htmlFor={referenceId}>Booking Reference</label>
            <div className={styles.searchRow}>
              <input
                ref={referenceInputRef}
                id={referenceId}
                className={styles.referenceInput}
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value.toUpperCase());
                  if (error) setError(null);
                }}
                placeholder={BOOKING_REFERENCE_PLACEHOLDER}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={BOOKING_REFERENCE_MAX_LENGTH + 4}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${referenceHintId} ${errorId}` : referenceHintId}
                required
              />
              <Button
                variant="primary"
                type="submit"
                className={styles.submit}
                loading={busy}
                loadingText="Tracking…"
                icon={<SearchIcon />}
              >
                Track Booking
              </Button>
            </div>
            <small id={referenceHintId}>
              You can find it in your booking confirmation email, e.g.{" "}
              <span className={styles.nowrap}>{BOOKING_REFERENCE_PLACEHOLDER}</span>.
            </small>
          </div>
          {error ? <p id={errorId} className={styles.error} role="alert">{error}</p> : null}
        </form>

        {result ? (
          <section className={styles.result} aria-labelledby={resultHeadingId}>
            <header className={styles.summary}>
              <div className={styles.statusTopline}>
                <div className={styles.summaryField}>
                  <span className={styles.eyebrow}>Booking Reference</span>
                  <p className={styles.reference}>{result.bookingReference}</p>
                </div>
                <div className={`${styles.summaryField} ${styles.summaryStatus}`}>
                  <span className={styles.eyebrow}>Current Status</span>
                  <StatusBadge status={result.status} label={TRACKING_BADGE_LABELS[result.status]} />
                </div>
              </div>
              <div className={styles.statusDetail}>
                <h3 id={resultHeadingId} ref={resultHeadingRef} tabIndex={-1} className={styles.statusLabel}>
                  {result.statusLabel}
                </h3>
                <p className={styles.statusMessage}>{result.statusMessage}</p>
                <p className={styles.updated}>Last updated {formatManilaDateTime(result.updatedAt)}</p>
              </div>
            </header>

            <dl className={styles.facts}>
              <div className={styles.factWide}>
                <dt>{result.items.length > 1 ? "Items" : "Item"}</dt>
                <dd>
                  {result.items.length ? (
                    <ul className={styles.itemList}>
                      {result.items.map((item, index) => (
                        <li key={`${item.name}-${index}`}>{itemLabel(item)}</li>
                      ))}
                    </ul>
                  ) : "Rental item"}
                </dd>
              </div>
              <div>
                <dt>Fulfillment</dt>
                <dd>{handoverLabel}</dd>
              </div>
              <div>
                <dt>{handoverLabel} date &amp; time</dt>
                <dd>{formatManilaDateTime(result.pickupAt)}</dd>
              </div>
              <div className={styles.factWide}>
                <dt>Return deadline</dt>
                <dd>{formatManilaDateTime(result.returnAt)}</dd>
              </div>
            </dl>

            <div className={styles.timelineSection}>
              <h4 className={styles.sectionTitle}>Tracking History</h4>
              <ol className={styles.timeline}>
                {result.steps.map((step) => (
                  <li
                    key={step.key}
                    className={`${styles.step} ${styles[`step_${step.state}`]}`}
                    aria-current={step.state === "current" ? "step" : undefined}
                  >
                    <StepMarker state={step.state} />
                    <div className={styles.stepBody}>
                      <div className={styles.stepHeading}>
                        <strong>{step.label}</strong>
                        <span className={styles.srOnly}> ({STEP_STATE_TEXT[step.state]})</span>
                        {step.state === "current" ? (
                          <span className={styles.currentPill} aria-hidden="true">In progress</span>
                        ) : step.state !== "closed" ? (
                          <span className={`${styles.stepTag} ${styles[`stepTag_${step.state}`]}`} aria-hidden="true">
                            {STEP_STATE_TEXT[step.state]}
                          </span>
                        ) : null}
                      </div>
                      {step.timestamp ? (
                        <time dateTime={step.timestamp}>{formatManilaDateTime(step.timestamp)}</time>
                      ) : null}
                      {step.state !== "upcoming" ? <p>{step.description}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className={styles.privateCard}>
              <span className={styles.privateIcon} aria-hidden="true"><LockIcon /></span>
              <div className={styles.privateBody}>
                <strong>Need documents, payments, or receipts?</strong>
                {result.detailsPath ? (
                  <>
                    <p>This booking is in your account. Open it to view documents, payments, and more.</p>
                    <Button variant="secondary" href={result.detailsPath} onClick={onClose} className={styles.privateAction}>
                      View Full Booking
                    </Button>
                  </>
                ) : isAccountHolder ? (
                  <p>
                    Payment details, agreements, receipts, and other documents are only available
                    to the account that made this booking.
                  </p>
                ) : (
                  <>
                    <p>
                      For your privacy, payment details, agreements, receipts, and other documents
                      are only available after signing in to the account used for this booking.
                    </p>
                    <div className={styles.privateActions}>
                      <Button variant="secondary" href={ACCOUNT_BOOKINGS_SIGN_IN} onClick={onClose} className={styles.privateAction}>
                        Sign In
                      </Button>
                      <Button variant="none" href="/guest/bookings" onClick={onClose} className={styles.textLink}>
                        Booked as a guest?
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
