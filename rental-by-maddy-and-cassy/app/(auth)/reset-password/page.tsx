import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import Navbar from "@/components/navbar/Navbar";
import ResetPasswordForm from "./ResetPasswordForm";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Choose New Password | Rental by Maddy & Cassy",
  description: "Securely choose a new account password.",
};

export default async function ResetPasswordPage() {
  const cookieStore = await cookies();
  const recoveryReady = cookieStore.get("maddy_password_recovery")?.value === "1";
  return (
    <div>
      <Navbar />
      <main className={styles.main}>
        <div className={styles.authLayout}>
          <section className={styles.authIntro} aria-labelledby="new-password-heading">
            <p className={styles.introEyebrow}>PROTECTED ACCESS</p>
            <h1 id="new-password-heading">Set a password only you know.</h1>
            <p>A strong, unique password helps protect customer records, payment status, and day-to-day rental operations.</p>
            <ul className={styles.authBenefits}>
              <li>Minimum strength requirements</li>
              <li>Secure recovery-session validation</li>
              <li>Fresh login required after the change</li>
            </ul>
            <p className={styles.securityNote}>Rental by Maddy & Cassy will never ask for your password.</p>
          </section>
          <Suspense fallback={null}><ResetPasswordForm recoveryReady={recoveryReady} /></Suspense>
        </div>
      </main>
    </div>
  );
}
