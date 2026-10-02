"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { checkActiveAdmin } from "@/src/services/adminService";
import {
  logout,
  resumeVerifiedSession,
  sendEmailOtp,
  VerifiedSessionSyncError,
  verifyEmailOtp,
} from "@/src/services/authService";
import { getUserProfile } from "@/src/services/userService";
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  clearOtpSent,
  isOtpExpired,
  readOtpSentAt,
  recordOtpSent,
  resendCooldownRemaining,
} from "@/src/lib/emailOtp";
import Spinner from "@/components/ui/Spinner";
import formStyles from "@/components/ui/Form.module.css";
import { Button } from "@/components/ui/Button";
import styles from "../auth.module.css";

const EXPIRED_MESSAGE = "This code has expired. Request a new one and try again.";

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

/**
 * Supabase answers every rejected code with the same "expired or invalid"
 * message, so the page uses its own record of when the latest code was sent to
 * say which one applies.
 */
function describeOtpError(error: unknown, expired: boolean): string {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("expired") ||
    normalized.includes("invalid") ||
    normalized.includes("token")
  ) {
    return expired
      ? EXPIRED_MESSAGE
      : "That code is incorrect or is no longer the latest one. Use the newest code we emailed you, or send a new code.";
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
  // When the newest code was sent. Replaced on every resend so that only the
  // latest code's 10-minute window is ever checked.
  const sentAtRef = useRef<number | null>(null);
  // Guards against double submits and against resending mid-verification.
  const verifyingRef = useRef(false);
  // Supabase codes are single-use: once one is accepted, a retry must resume the
  // signed-in session instead of submitting the (now spent) code again.
  const codeAcceptedRef = useRef(false);

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(OTP_RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (!email && !redirectedForMissingEmail.current) {
      redirectedForMissingEmail.current = true;
      router.replace(`/sign-in?redirect=${encodeURIComponent(redirectTo)}`);
    }
  }, [email, redirectTo, router]);

  useEffect(() => {
    if (!email) return;
    let sentAt = readOtpSentAt(email);
    if (sentAt === null) {
      sentAt = Date.now();
      recordOtpSent(email, sentAt);
    }
    sentAtRef.current = sentAt;
    // Session storage is only readable after hydration, so the cooldown for a
    // reloaded page is synced to the real send time here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCooldown(resendCooldownRemaining(sentAt));
  }, [email]);

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
    if (!email || cooldown > 0 || resending || verifyingRef.current) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await sendEmailOtp(email, { shouldCreateUser: flow === "sign-up" });
      // The earlier code is now void: restart the 10-minute window and drop
      // whatever was typed so it cannot be submitted against the new code.
      const sentAt = Date.now();
      sentAtRef.current = sentAt;
      recordOtpSent(email, sentAt);
      codeAcceptedRef.current = false;
      setCode("");
      setNotice(`A new 6-digit code was sent to ${email}. Any earlier code no longer works.`);
      setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
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
    if (verifyingRef.current || resending) return;
    if (!email || !/^\d{6}$/.test(code)) {
      setError("Enter the complete 6-digit verification code.");
      return;
    }
    const sentAt = sentAtRef.current;
    const expired = sentAt !== null && isOtpExpired(sentAt);
    if (expired && !codeAcceptedRef.current) {
      setError(EXPIRED_MESSAGE);
      setNotice(null);
      return;
    }
    verifyingRef.current = true;
    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      let user;
      if (codeAcceptedRef.current) {
        user = await resumeVerifiedSession();
        if (!user) {
          codeAcceptedRef.current = false;
          setError("Your verification session ended. Please send a new code to continue.");
          return;
        }
      } else {
        user = await verifyEmailOtp(email, code);
        codeAcceptedRef.current = true;
      }
      if (await checkActiveAdmin(user)) {
        codeAcceptedRef.current = false;
        await logout();
        setError("This is an administrator account. Please use the separate Admin Login.");
        return;
      }
      const profile = await getUserProfile(user.id);
      if (!profile || profile.accountStatus !== "active") {
        codeAcceptedRef.current = false;
        await logout();
        setError(
          profile?.accountStatus === "suspended"
            ? "This customer account is suspended. Please contact support for assistance."
            : "Your customer profile could not be prepared. Please contact support.",
        );
        return;
      }
      clearOtpSent(email);
      setVerified(true);
    } catch (verifyError) {
      if (verifyError instanceof VerifiedSessionSyncError) {
        codeAcceptedRef.current = true;
        setError(verifyError.message);
      } else if (codeAcceptedRef.current) {
        setError("We couldn't finish signing you in. Please check your connection and try again.");
      } else {
        setError(describeOtpError(verifyError, expired));
      }
    } finally {
      verifyingRef.current = false;
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

          <Button
            type="submit"
            variant="primary"
            className={styles.submitButton}
            loading={verifying}
            loadingText="Verifying..."
            disabled={code.length !== 6}
          >
            Verify &amp; Continue
          </Button>
      </form>

      <div className={styles.verifyActions}>
          <Button
            variant="none"
            type="button"
            onClick={() => void resend()}
            disabled={resending || verifying || cooldown > 0}
          >
            {resending
              ? "Sending..."
              : cooldown > 0
                ? `Resend code in ${cooldown}s`
                : "Send a new code"}
          </Button>
          <Button variant="none" type="button" onClick={useAnotherEmail}>
            Use another email
          </Button>
      </div>
    </div>
  );
}
