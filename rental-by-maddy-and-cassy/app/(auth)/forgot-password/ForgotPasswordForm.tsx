"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { normalizeEmail } from "@/src/lib/authValidation";
import { requestPasswordReset } from "@/src/services/authService";
import formStyles from "@/components/ui/Form.module.css";
import styles from "../auth.module.css";

const schema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const source = searchParams.get("source") === "customer" ? "customer" : "admin";
  const invalidLink = searchParams.get("error") === "invalid_link";
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(normalizeEmail(values.email), `/reset-password?source=${source}`);
      setSent(true);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      setFormError(message.includes("rate") || message.includes("seconds")
        ? "Too many reset requests. Please wait a moment before trying again."
        : "The reset email could not be sent right now. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Account recovery</p>
      <h1 className={styles.heading}>Reset your password</h1>
      <p className={styles.subheading}>
        {source === "admin"
          ? "Enter your administrator email and we'll send a secure recovery link."
          : "Customer accounts normally sign in using an email code, without a password."}
      </p>

      {sent ? (
        <div>
          <p className={styles.successNotice} role="status">
            If a password-based account exists for that email, a reset link has been sent. Check your inbox and spam folder.
          </p>
          <div className={styles.successActions}>
            <Link className={`${formStyles.primaryButton} ${styles.submitButton}`} href={source === "admin" ? "/admin/sign-in" : "/sign-in"}>
              Return to login
            </Link>
          </div>
        </div>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
          {invalidLink ? <p className={styles.formError} role="alert">That recovery link is invalid or has expired. Request a new one below.</p> : null}
          {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
          <div className={formStyles.field}>
            <label className={formStyles.label} htmlFor="recovery-email">
              Email address<span className={formStyles.required}>*</span>
            </label>
            <input
              id="recovery-email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              className={`${formStyles.input} ${errors.email ? formStyles.inputError : ""}`}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "recovery-email-error" : undefined}
              {...register("email")}
            />
            {errors.email ? <p id="recovery-email-error" className={formStyles.errorText} role="alert">{errors.email.message}</p> : null}
          </div>
          <button type="submit" className={`${formStyles.primaryButton} ${styles.submitButton}`} disabled={submitting}>
            {submitting ? "Sending secure link..." : "Send Reset Link"}
          </button>
        </form>
      )}

      <p className={styles.footer}>
        <Link className={styles.footerLink} href={source === "admin" ? "/admin/sign-in" : "/sign-in"}>
          Back to {source === "admin" ? "Admin Login" : "Customer Sign In"}
        </Link>
      </p>
    </div>
  );
}
