"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { sendEmailOtp } from "@/src/services/authService";
import { normalizeEmail } from "@/src/lib/authValidation";
import formStyles from "@/components/ui/Form.module.css";
import styles from "../auth.module.css";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
});

type FormValues = z.infer<typeof schema>;

function getCustomerRedirect(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/admin")) {
    return "/account/bookings";
  }
  return value;
}

export default function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const redirectTo = getCustomerRedirect(searchParams.get("redirect"));
  const accountNotice = searchParams.get("error") === "suspended"
    ? "This customer account is suspended. Please contact support for assistance."
    : searchParams.get("signedOut") === "true"
      ? "You have been signed out securely."
      : searchParams.get("reset") === "success"
        ? "Your password was updated. Customer access still uses a secure email code."
      : null;

  async function onSubmit(values: FormValues) {
    setFormError(null);
    setSubmitting(true);
    try {
      const email = normalizeEmail(values.email);
      await sendEmailOtp(email, {
        shouldCreateUser: false,
      });
      router.replace(
        `/verify-email?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirectTo)}&flow=sign-in`,
      );
    } catch (error) {
      setFormError(
        error instanceof Error && error.message
          ? error.message
          : "We couldn't send a code to that email. Check the address and try again, or create an account.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Welcome back</p>
      <h1 className={styles.heading}>Customer Sign In</h1>
      <p className={styles.subheading}>
        Enter your email and we&apos;ll send you a 6-digit one-time code to
        sign in.
      </p>

      <div className={styles.methodNote}>
        <span aria-hidden="true">✉</span>
        <p><strong>Passwordless customer login.</strong> Each code is single-use and sent only to your registered email.</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {accountNotice ? <p className={accountNotice.includes("suspended") ? styles.formError : styles.successNotice} role="status">{accountNotice}</p> : null}
        {formError ? <p className={styles.formError}>{formError}</p> : null}

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="email">
            Email address<span className={formStyles.required}>*</span>
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={`${formStyles.input} ${errors.email ? formStyles.inputError : ""}`}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            autoCapitalize="none"
            spellCheck={false}
            {...register("email")}
          />
          {errors.email ? (
            <p className={formStyles.errorText} id="email-error" role="alert">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className={styles.submitRow}>
          <button
            type="submit"
            className={`${formStyles.primaryButton} ${styles.submitButton}`}
            disabled={submitting}
          >
            {submitting ? "Sending code..." : "Send Code"}
          </button>
        </div>
      </form>

      <p className={styles.footer}>
        Don&apos;t have an account?{" "}
        <Link
          href={`/sign-up${redirectTo !== "/account/bookings" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
          className={styles.footerLink}
        >
          Create one
        </Link>
      </p>
      <p className={styles.footer}>
        Are you an administrator?{" "}
        <Link href="/admin/sign-in" className={styles.footerLink}>
          Admin Login
        </Link>
      </p>
    </div>
  );
}
