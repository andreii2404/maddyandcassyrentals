import type { Metadata } from "next";
import { Suspense } from "react";
import ForgotPasswordForm from "./ForgotPasswordForm";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Reset Password | Rental by Maddy & Cassy",
  description: "Securely recover password-based account access.",
};

export default function ForgotPasswordPage() {
  return (
    <div>
      <main className={styles.main}>
        <div className={styles.authLayout}>
          <section className={styles.authIntro} aria-labelledby="recovery-heading">
            <p className={styles.introEyebrow}>SECURE RECOVERY</p>
            <h1 id="recovery-heading">Regain access safely.</h1>
            <p>Recovery links are time-limited and delivered only through the verified email address attached to the account.</p>
            <ul className={styles.authBenefits}>
              <li>No account details are exposed</li>
              <li>Strong password rules are applied</li>
              <li>Existing sessions remain protected</li>
            </ul>
            <p className={styles.securityNote}>Never share a password reset link or one-time code.</p>
          </section>
          <Suspense fallback={null}><ForgotPasswordForm /></Suspense>
        </div>
      </main>
    </div>
  );
}
