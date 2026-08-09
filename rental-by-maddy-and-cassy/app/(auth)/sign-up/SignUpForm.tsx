"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { sendEmailOtp } from "@/src/services/authService";
import {
  isValidPhoneNumber,
  normalizeEmail,
  normalizePhoneInput,
  PHONE_DIGIT_COUNT,
} from "@/src/lib/authValidation";
import formStyles from "@/components/ui/Form.module.css";
import styles from "../auth.module.css";

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter your complete name").max(150, "Name is too long"),
  phone: z.string().refine(isValidPhoneNumber, `Phone number must contain exactly ${PHONE_DIGIT_COUNT} digits`),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
});

type FormValues = z.infer<typeof schema>;

function getCustomerRedirect(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/admin")) {
    return "/catalog";
  }
  return value;
}

export default function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: "", phone: "", email: "" },
  });

  const redirectTo = getCustomerRedirect(searchParams.get("redirect"));

  async function onSubmit(values: FormValues) {
    setFormError(null);
    setSubmitting(true);
    try {
      const email = normalizeEmail(values.email);
      await sendEmailOtp(email, {
        shouldCreateUser: true,
        profileData: {
          displayName: values.fullName.trim(),
          phoneNumber: values.phone,
        },
      });
      router.replace(
        `/verify-email?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirectTo)}&flow=sign-up`,
      );
    } catch (error) {
      setFormError(
        error instanceof Error && error.message
          ? error.message
          : "We couldn't send a code to that email. Check the address and try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Customer account</p>
      <h1 className={styles.heading}>Create Account</h1>
      <p className={styles.subheading}>
        Add your basic contact details, then verify your email with a secure
        6-digit code. No password is needed for customer accounts.
      </p>

      <div className={styles.methodNote}>
        <span aria-hidden="true">✓</span>
        <p><strong>No duplicate accounts.</strong> If the email is already registered, verification securely returns you to that account.</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {formError ? <p className={styles.formError}>{formError}</p> : null}

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="signup-name">
            Full name<span className={formStyles.required}>*</span>
          </label>
          <input
            id="signup-name"
            autoComplete="name"
            className={`${formStyles.input} ${errors.fullName ? formStyles.inputError : ""}`}
            aria-invalid={!!errors.fullName}
            aria-describedby={errors.fullName ? "signup-name-error" : undefined}
            {...register("fullName")}
          />
          {errors.fullName ? <p id="signup-name-error" className={formStyles.errorText} role="alert">{errors.fullName.message}</p> : null}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label} htmlFor="signup-phone">
            Active phone number<span className={formStyles.required}>*</span>
          </label>
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <input
                id="signup-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={PHONE_DIGIT_COUNT}
                placeholder="09XXXXXXXXX"
                className={`${formStyles.input} ${errors.phone ? formStyles.inputError : ""}`}
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? "signup-phone-error" : "signup-phone-help"}
                {...field}
                onChange={(event) => field.onChange(normalizePhoneInput(event.target.value))}
              />
            )}
          />
          <p id="signup-phone-help" className={formStyles.helpText}>Use exactly 11 digits.</p>
          {errors.phone ? <p id="signup-phone-error" className={formStyles.errorText} role="alert">{errors.phone.message}</p> : null}
        </div>

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
            autoCapitalize="none"
            spellCheck={false}
            {...register("email")}
          />
          {errors.email ? (
            <p className={formStyles.errorText} role="alert">
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
        Already have an account?{" "}
        <Link
          href={`/sign-in${redirectTo !== "/catalog" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
          className={styles.footerLink}
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
