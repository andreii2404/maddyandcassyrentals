"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { startGuestCheckout } from "@/src/services/authService";
import {
  BOOKING_LOOKUP_CODE_LENGTH,
  BOOKING_REFERENCE_MAX_LENGTH,
  BOOKING_REFERENCE_PLACEHOLDER,
  isValidBookingReference,
  normalizeBookingReference,
  normalizeLookupCode,
  type BookingLookupResult,
} from "@/src/lib/bookingLookup";
import styles from "./TrackBookingModal.module.css";

interface TrackBookingModalProps {
  onClose: () => void;
}

type Step =
  | { kind: "reference" }
  | { kind: "code"; reference: string; challengeId: string; expiresInMinutes: number }
  | { kind: "sign_in"; reference: string; path: string };

const RESEND_COOLDOWN_SECONDS = 60;
const NETWORK_ERROR = "We couldn't reach the booking service. Check your connection and try again.";

interface ApiResponse {
  result: BookingLookupResult | null;
  error: string | null;
  code: string | null;
}

async function postLookup(url: string, payload: Record<string, string>): Promise<ApiResponse> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as
    | { status?: unknown; error?: unknown; code?: unknown }
    | null;
  return {
    result: response.ok && typeof body?.status === "string" ? (body as BookingLookupResult) : null,
    error: typeof body?.error === "string" ? body.error : null,
    code: typeof body?.code === "string" ? body.code : null,
  };
}

function errorMessage(error: unknown): string {
  // fetch() rejects with a TypeError when the network request itself fails.
  if (error instanceof TypeError || !(error instanceof Error) || !error.message) return NETWORK_ERROR;
  return error.message;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/**
 * Track Booking: look up a booking by reference. Signed-in owners open it
 * directly; everyone else verifies with a one-time code emailed to the address
 * on that booking, so the reference alone never exposes booking details.
 */
export default function TrackBookingModal({ onClose }: TrackBookingModalProps) {
  const router = useRouter();
  const { user } = useAuth();
  const isAccountHolder = Boolean(user) && !user?.is_anonymous;
  const [step, setStep] = useState<Step>({ kind: "reference" });
  const [reference, setReference] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const descriptionId = useId();
  const referenceId = useId();
  const referenceHintId = useId();
  const codeId = useId();
  const errorId = useId();

  // Modal focuses its dialog after mount; move focus to the active field next.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (step.kind === "reference") referenceInputRef.current?.focus();
      if (step.kind === "code") codeInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [step.kind]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  function handleClose() {
    if (busy) return;
    onClose();
  }

  function openPath(path: string, fullReload: boolean) {
    if (fullReload) {
      // The guest session changed, so load the tracker with fresh auth state.
      window.location.assign(path);
      return;
    }
    onClose();
    router.push(path);
  }

  /** Runs the reference lookup; returns true when it moved to the next step. */
  async function requestLookup(normalized: string): Promise<boolean> {
    const response = await postLookup("/api/bookings/lookup", { bookingReference: normalized });
    if (response.result?.status === "open") {
      openPath(response.result.path, false);
      return true;
    }
    if (response.result?.status === "verify") {
      setStep({
        kind: "code",
        reference: normalized,
        challengeId: response.result.challengeId,
        expiresInMinutes: response.result.expiresInMinutes,
      });
      setCode("");
      setResendIn(RESEND_COOLDOWN_SECONDS);
      return true;
    }
    setError(response.error ?? "We couldn't search for that booking. Please try again.");
    return false;
  }

  async function searchBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalized = normalizeBookingReference(reference);
    setReference(normalized);
    setNotice(null);
    if (!isValidBookingReference(normalized)) {
      setError(`Enter a booking reference in this format: ${BOOKING_REFERENCE_PLACEHOLDER}.`);
      referenceInputRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await requestLookup(normalized);
    } catch (lookupError) {
      setError(errorMessage(lookupError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || step.kind !== "code") return;
    if (code.length !== BOOKING_LOOKUP_CODE_LENGTH) {
      setError("Enter the 6-digit code from the verification email.");
      codeInputRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = { challengeId: step.challengeId, code };
      let response = await postLookup("/api/bookings/lookup/verify", payload);
      let startedGuestSession = false;

      if (response.code === "GUEST_SESSION_REQUIRED") {
        if (isAccountHolder) {
          setError("This is a guest booking. Sign out of your customer account, then track it again.");
          setBusy(false);
          return;
        }
        // Guest access lives in a temporary guest session that holds only this
        // verified booking; no customer account is created.
        await startGuestCheckout();
        startedGuestSession = true;
        response = await postLookup("/api/bookings/lookup/verify", payload);
      }

      if (response.result?.status === "open") {
        openPath(
          response.result.path,
          startedGuestSession || response.result.path.startsWith("/guest/"),
        );
        return;
      }
      if (response.result?.status === "sign_in") {
        setStep({ kind: "sign_in", reference: step.reference, path: response.result.path });
        setBusy(false);
        return;
      }

      setError(response.error ?? "That code could not be verified. Please try again.");
      setCode("");
      codeInputRef.current?.focus();
      setBusy(false);
    } catch (verifyError) {
      setError(errorMessage(verifyError));
      setBusy(false);
    }
  }

  async function resendCode() {
    if (step.kind !== "code" || busy || resending || resendIn > 0) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      if (await requestLookup(step.reference)) {
        setNotice("A new code was sent. Earlier codes no longer work.");
      }
    } catch (resendError) {
      setError(errorMessage(resendError));
    } finally {
      setResending(false);
    }
  }

  function changeReference() {
    setStep({ kind: "reference" });
    setCode("");
    setError(null);
    setNotice(null);
  }

  return (
    <Modal title="Track Booking" onClose={handleClose} describedBy={descriptionId} size="small">
      {step.kind === "reference" ? (
        <form className={styles.body} onSubmit={searchBooking} noValidate>
          <div id={descriptionId} className={styles.intro}>
            <span className={styles.icon} aria-hidden="true"><SearchIcon /></span>
            <p>
              {isAccountHolder
                ? "Enter a booking reference to open that booking from your account."
                : "Enter your booking reference. For your privacy, we'll email a one-time code to the address used for that booking."}
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor={referenceId}>Booking Reference</label>
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
            <small id={referenceHintId}>
              Find it in your booking confirmation email, such as{" "}
              <span className={styles.nowrap}>{BOOKING_REFERENCE_PLACEHOLDER}</span>.
            </small>
          </div>

          {error ? <p id={errorId} className={styles.error} role="alert">{error}</p> : null}

          <Button
            variant="primary"
            type="submit"
            className={styles.submit}
            loading={busy}
            loadingText="Searching…"
            icon={<SearchIcon />}
          >
            Search Booking
          </Button>
        </form>
      ) : step.kind === "code" ? (
        <form className={styles.body} onSubmit={verifyCode} noValidate>
          <div id={descriptionId} className={styles.intro}>
            <span className={styles.icon} aria-hidden="true"><ShieldIcon /></span>
            <p>
              We sent a 6-digit code to the email address used for booking{" "}
              <strong className={styles.reference}>{step.reference}</strong>. It expires in{" "}
              {step.expiresInMinutes} minutes.
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor={codeId}>Verification Code</label>
            <input
              ref={codeInputRef}
              id={codeId}
              className={styles.codeInput}
              value={code}
              onChange={(event) => {
                setCode(normalizeLookupCode(event.target.value));
                if (error) setError(null);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={BOOKING_LOOKUP_CODE_LENGTH}
              placeholder="000000"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              required
            />
          </div>

          {error ? <p id={errorId} className={styles.error} role="alert">{error}</p> : null}
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

          <Button
            variant="primary"
            type="submit"
            className={styles.submit}
            loading={busy}
            loadingText="Verifying…"
          >
            Verify &amp; View Booking
          </Button>

          <div className={styles.secondaryActions}>
            <Button
              variant="none"
              className={styles.textButton}
              onClick={() => void resendCode()}
              disabled={busy || resending || resendIn > 0}
            >
              {resending ? "Sending…" : resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
            </Button>
            <Button
              variant="none"
              className={styles.textButton}
              onClick={changeReference}
              disabled={busy}
            >
              Use a different reference
            </Button>
          </div>

          <p className={styles.privacyNote}>
            Didn&apos;t get it? Check your spam folder. Booking details are shown only after the
            code is verified.
          </p>
        </form>
      ) : (
        <div className={styles.body}>
          <div id={descriptionId} className={styles.intro}>
            <span className={styles.icon} aria-hidden="true"><ShieldIcon /></span>
            <p>
              Verified. Booking <strong className={styles.reference}>{step.reference}</strong> is
              saved in a customer account. Sign in to that account to view it.
            </p>
          </div>
          <Button
            variant="primary"
            className={styles.submit}
            onClick={() => openPath(step.path, false)}
          >
            Continue to Sign In
          </Button>
        </div>
      )}
    </Modal>
  );
}
