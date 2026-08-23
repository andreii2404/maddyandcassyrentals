"use client";

import { useState, type FormEvent } from "react";
import { normalizeEmail, normalizePhoneInput, PHONE_DIGIT_COUNT } from "@/src/lib/authValidation";
import { startGuestCheckout } from "@/src/services/authService";
import styles from "./GuestBookingRecoveryForm.module.css";

interface GuestBookingRecoveryFormProps {
  hasGuestSession?: boolean;
}

export default function GuestBookingRecoveryForm({
  hasGuestSession = false,
}: GuestBookingRecoveryFormProps) {
  const [bookingReference, setBookingReference] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [guestSessionReady, setGuestSessionReady] = useState(hasGuestSession);
  const [error, setError] = useState<string | null>(null);

  async function recoverBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const normalizedReference = bookingReference.trim().toUpperCase();
    const normalizedEmail = normalizeEmail(email);
    if (!/^BK-[A-Z0-9]{6,20}$/.test(normalizedReference)) {
      setError("Enter the booking reference shown on your confirmation, such as BK-XXXXXXXXXX.");
      return;
    }
    if (!normalizedEmail || phoneNumber.length !== PHONE_DIGIT_COUNT) {
      setError("Enter the checkout email and the complete 11-digit mobile number.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (!guestSessionReady) {
        await startGuestCheckout();
        setGuestSessionReady(true);
      }

      const response = await fetch("/api/guest/bookings/recover", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingReference: normalizedReference,
          email: normalizedEmail,
          phoneNumber,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: unknown; bookingId?: unknown }
        | null;
      if (!response.ok || typeof body?.bookingId !== "string") {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Guest booking access could not be restored.",
        );
      }

      window.location.assign(`/guest/bookings/${encodeURIComponent(body.bookingId)}?recovered=1`);
    } catch (recoveryError) {
      setError(
        recoveryError instanceof Error
          ? recoveryError.message
          : "Guest booking access could not be restored.",
      );
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="guest-recovery-heading">
      <div className={styles.intro}>
        <span aria-hidden="true">↗</span>
        <div>
          <p>GUEST BOOKING TRACKER</p>
          <h1 id="guest-recovery-heading">Find your booking again</h1>
          <small>
            No account is required. Enter the same details used during checkout to securely
            restore this booking in your browser.
          </small>
        </div>
      </div>

      <form className={styles.form} onSubmit={recoverBooking}>
        <label>
          <span>Booking reference</span>
          <input
            value={bookingReference}
            onChange={(event) => setBookingReference(event.target.value.toUpperCase())}
            placeholder="BK-XXXXXXXXXX"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={23}
            required
          />
        </label>
        <label>
          <span>Checkout email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label>
          <span>Mobile number</span>
          <input
            type="tel"
            inputMode="numeric"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(normalizePhoneInput(event.target.value))}
            placeholder="09XXXXXXXXX"
            autoComplete="tel"
            maxLength={PHONE_DIGIT_COUNT}
            required
          />
          <small>Use the exact 11-digit number entered during booking.</small>
        </label>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "Restoring access…" : "Track Guest Booking"}
        </button>
      </form>
    </section>
  );
}
