"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { checkActiveAdmin } from "@/src/services/adminService";
import { logout, sendEmailOtp, verifyEmailOtp } from "@/src/services/authService";
import { getUserProfile } from "@/src/services/userService";
import Spinner from "@/components/ui/Spinner";
import formStyles from "@/components/ui/Form.module.css";
import styles from "../auth.module.css";

const RESEND_COOLDOWN_SECONDS = 60;

function getCustomerRedirect(value: string | null, flow: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/admin") ||
    value.startsWith("/verify-email")
  ) {
    return flow === "sign-up" ? "/catalog" : "/account/bookings";
  }
  return value;
}

function describeOtpError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (normalized.includes("expired") && normalized.includes("invalid")) {
    return "That code is incorrect or has expired. Request a new one and try again.";
  }
  if (normalized.includes("expired")) {
    return "This code has expired. Request a new one and try again.";
  }
  if (normalized.includes("invalid") || normalized.includes("token")) {
    return "That code is incorrect. Please check it and try again.";
  }
  return message || "The verification code could not be confirmed.";
}

export default function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const flow = searchParams.get("flow");
  const redirectTo = getCustomerRedirect(searchParams.get("redirect"), flow);
  const redirectedForMissingEmail = useRef(false);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (!email && !redirectedForMissingEmail.current) {
      redirectedForMissingEmail.current = true;
      router.replace(`/sign-in?redirect=${encodeURIComponent(redirectTo)}`);
    }
  }, [email, redirectTo, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!verified) return;
    const timeout = setTimeout(() => {
      router.replace(redirectTo);
      router.refresh();
    }, 900);
    return () => clearTimeout(timeout);
  }, [verified, redirectTo, router]);

  async function resend() {
    if (!email || cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await sendEmailOtp(email, { shouldCreateUser: flow === "sign-up" });
      setNotice(`A new 6-digit code was sent to ${email}.`);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "The verification code could not be sent.",
      );
    } finally {
      setResending(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email || !/^\d{6}$/.test(code)) {
      setError("Enter the complete 6-digit verification code.");
      return;
    }
    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      const user = await verifyEmailOtp(email, code);
      if (await checkActiveAdmin(user)) {
        await logout();
        setError("This is an administrator account. Please use the separate Admin Login.");
        setVerifying(false);
        return;
      }
      const profile = await getUserProfile(user.id);
      if (!profile || profile.accountStatus !== "active") {
        await logout();
        setError(
          profile?.accountStatus === "suspended"
            ? "This customer account is suspended. Please contact support for assistance."
            : "Your customer profile could not be prepared. Please contact support.",
        );
        setVerifying(false);
        return;
      }
      setVerified(true);
    } catch (verifyError) {
      setError(describeOtpError(verifyError));
    } finally {
      setVerifying(false);
    }
  }

  function useAnotherEmail() {
    router.replace(
      `/${flow === "sign-up" ? "sign-up" : "sign-in"}?redirect=${encodeURIComponent(redirectTo)}`,
    );
  }

  if (!email) {
    return (
      <div className={styles.card}>
        <div className={styles.authLoading}>
          <Spinner size={28} label="Redirecting to sign in" />
        </div>
      </div>
    );
  }

  if (verified) {
    return (
      <div className={styles.card}>
        <p className={styles.eyebrow}>Success</p>
        <h1 className={styles.heading}>Email Verified</h1>
        <p className={styles.successNotice} role="status">
          Your email is verified. Redirecting you now...
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Secure your account</p>
      <h1 className={styles.heading}>Verify Your Email</h1>
      <p className={styles.subheading}>
        Enter the 6-digit code sent to <strong>{email}</strong>. The code
        expires after 10 minutes.
      </p>

      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      <form className={styles.form} onSubmit={submit}>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="otp-code">
            6-digit verification code
          </label>
          <input
            id="otp-code"
            className={`${formStyles.input} ${styles.otpInput}`}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            pattern="\d*"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            autoFocus
          />
        </div>

        <button
          type="submit"
          className={`${formStyles.primaryButton} ${styles.submitButton}`}
          disabled={verifying || code.length !== 6}
        >
          {verifying ? "Verifying..." : "Verify & Continue"}
        </button>
      </form>

      <div className={styles.verifyActions}>
        <button type="button" onClick={() => void resend()} disabled={resending || cooldown > 0}>
          {resending
            ? "Sending..."
            : cooldown > 0
              ? `Resend code in ${cooldown}s`
              : "Send a new code"}
        </button>
        <button type="button" onClick={useAnotherEmail}>
          Use another email
        </button>
      </div>
    </div>
  );
}
