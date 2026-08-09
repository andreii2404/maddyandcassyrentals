"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { loginWithEmail, logout } from "@/src/services/authService";
import { useAuth } from "@/hooks/useAuth";
import formStyles from "@/components/ui/Form.module.css";
import PasswordInput from "@/components/ui/PasswordInput";
import styles from "../../(auth)/auth.module.css";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

function getAdminRedirect(value: string | null): string {
  if (!value || value === "/admin/sign-in") return "/admin";
  if (value === "/admin" || value.startsWith("/admin/")) return value;
  return "/admin";
}

export default function AdminSignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAdmin, loading } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const redirectTo = getAdminRedirect(searchParams.get("redirect"));
  const resetNotice = searchParams.get("reset") === "success"
    ? "Your password was updated. Sign in with your new password."
    : null;

  useEffect(() => {
    if (!loading && user && isAdmin) {
      router.replace(redirectTo);
    }
  }, [isAdmin, loading, redirectTo, router, user]);

  async function onSubmit(values: FormValues) {
    setFormError(null);
    setSubmitting(true);

    try {
      await loginWithEmail(values.email, values.password);
      const sessionResponse = await fetch("/api/admin/session", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!sessionResponse.ok) {
        const body = (await sessionResponse.json().catch(() => null)) as
          | { error?: unknown }
          | null;
        await logout();
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Administrator access could not be verified.",
        );
      }

      // Use a full navigation after the server validates the admin session.
      // This starts the protected area from the persisted cookie and avoids
      // racing the client-side role lookup against RequireAdmin.
      window.location.assign(redirectTo);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "We couldn't sign you in. Check your admin email and password and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Authorized access only</p>
      <h1 className={styles.heading}>Admin Login</h1>
      <p className={styles.subheading}>
        Sign in with an active administrator account to access rental operations.
      </p>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {resetNotice ? <p className={styles.successNotice} role="status">{resetNotice}</p> : null}
        {formError ? <p className={styles.formError}>{formError}</p> : null}

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="admin-email">
            Admin email address<span className={formStyles.required}>*</span>
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="email"
            className={`${formStyles.input} ${errors.email ? formStyles.inputError : ""}`}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "admin-email-error" : undefined}
            autoCapitalize="none"
            spellCheck={false}
            {...register("email")}
          />
          {errors.email ? (
            <p className={formStyles.errorText} id="admin-email-error" role="alert">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="admin-password">
            Password<span className={formStyles.required}>*</span>
          </label>
          <PasswordInput
            id="admin-password"
            autoComplete="current-password"
            className={`${formStyles.input} ${errors.password ? formStyles.inputError : ""}`}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "admin-password-error" : undefined}
            {...register("password")}
          />
          {errors.password ? (
            <p className={formStyles.errorText} id="admin-password-error" role="alert">
              {errors.password.message}
            </p>
          ) : null}
          <div className={styles.forgotRow}>
            <Link href="/forgot-password?source=admin" className={styles.forgotLink}>
              Forgot password?
            </Link>
          </div>
        </div>

        <div className={styles.submitRow}>
          <button
            type="submit"
            className={`${formStyles.primaryButton} ${styles.submitButton}`}
            disabled={submitting}
          >
            {submitting ? "Verifying access..." : "Admin Login"}
          </button>
        </div>
      </form>

      <p className={styles.footer}>
        Renting as a customer?{" "}
        <Link href="/sign-in" className={styles.footerLink}>
          Customer Sign In
        </Link>
      </p>
    </div>
  );
}
