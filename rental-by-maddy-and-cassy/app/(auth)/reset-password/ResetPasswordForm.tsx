"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getPasswordValidationErrors, isStrongPassword } from "@/src/lib/authValidation";
import { logout } from "@/src/services/authService";
import PasswordInput from "@/components/ui/PasswordInput";
import formStyles from "@/components/ui/Form.module.css";
import styles from "../auth.module.css";

const schema = z.object({
  password: z.string().refine(isStrongPassword, "Use a stronger password that meets every requirement"),
  confirmPassword: z.string().min(1, "Confirm your new password"),
}).refine((values) => values.password === values.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
});

type FormValues = z.infer<typeof schema>;

const requirements = [
  "At least 8 characters",
  "One lowercase letter",
  "One uppercase letter",
  "One number",
];

export default function ResetPasswordForm({ recoveryReady }: { recoveryReady: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source") === "customer" ? "customer" : "admin";
  const destination = source === "admin" ? "/admin/sign-in?reset=success" : "/sign-in?reset=success";
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, control, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const password = useWatch({ control, name: "password" });
  const missingRequirements = getPasswordValidationErrors(password);

  useEffect(() => {
    if (!complete) return;
    const timeout = window.setTimeout(() => router.replace(destination), 1600);
    return () => window.clearTimeout(timeout);
  }, [complete, destination, router]);

  async function onSubmit(values: FormValues) {
    setFormError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof body?.error === "string" ? body.error : "Password update failed.");
      }
      await logout();
      setComplete(true);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      setFormError(message.includes("same password")
        ? "Choose a password you have not used for this account."
        : message.includes("session") || message.includes("token")
          ? "This reset link is invalid or has expired. Request a new link."
          : "Your password could not be updated. Please request a new reset link and try again.");
      setSubmitting(false);
    }
  }

  if (!recoveryReady && !complete) {
    return (
      <div className={styles.card}>
        <p className={styles.eyebrow}>Reset link unavailable</p>
        <h1 className={styles.heading}>Request a new link</h1>
        <p className={styles.subheading}>This password reset link is invalid, expired, or has already been used.</p>
        <Link className={`${formStyles.primaryButton} ${styles.submitButton}`} href={`/forgot-password?source=${source}`}>
          Send a New Reset Link
        </Link>
      </div>
    );
  }

  if (complete) {
    return (
      <div className={styles.card}>
        <p className={styles.eyebrow}>Password updated</p>
        <h1 className={styles.heading}>Your account is secure.</h1>
        <p className={styles.successNotice} role="status">Your password was changed successfully. Returning you to login...</p>
        <div className={styles.successActions}>
          <Link className={`${formStyles.primaryButton} ${styles.submitButton}`} href={destination}>Continue to Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Choose a new password</p>
      <h1 className={styles.heading}>Create a strong password</h1>
      <p className={styles.subheading}>Use a password that is unique to this account.</p>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="new-password">New password<span className={formStyles.required}>*</span></label>
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            className={`${formStyles.input} ${errors.password ? formStyles.inputError : ""}`}
            aria-invalid={!!errors.password}
            aria-describedby="password-requirements"
            {...register("password")}
          />
          <ul id="password-requirements" className={styles.passwordRules}>
            {requirements.map((requirement) => (
              <li key={requirement} className={missingRequirements.includes(requirement) ? styles.ruleMissing : styles.ruleMet}>
                {requirement}
              </li>
            ))}
          </ul>
          {errors.password ? <p className={formStyles.errorText} role="alert">{errors.password.message}</p> : null}
        </div>
        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="confirm-password">Confirm new password<span className={formStyles.required}>*</span></label>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            className={`${formStyles.input} ${errors.confirmPassword ? formStyles.inputError : ""}`}
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? <p id="confirm-password-error" className={formStyles.errorText} role="alert">{errors.confirmPassword.message}</p> : null}
        </div>
        <button type="submit" className={`${formStyles.primaryButton} ${styles.submitButton}`} disabled={submitting}>
          {submitting ? "Updating password..." : "Update Password"}
        </button>
      </form>
    </div>
  );
}
