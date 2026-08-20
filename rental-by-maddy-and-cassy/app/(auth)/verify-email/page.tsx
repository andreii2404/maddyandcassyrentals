import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import VerifyEmailForm from "./VerifyEmailForm";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Verify Email | Rental by Maddy & Cassy",
  description: "Verify your customer account using a secure one-time code.",
};

export default function VerifyEmailPage() {
  return (
    <div>
      <main className={styles.main}>
        <div className={styles.authLayout}>
          <section className={styles.authIntro} aria-labelledby="verify-account-heading">
            <p className={styles.introEyebrow}>EMAIL VERIFICATION</p>
            <h1 id="verify-account-heading">One quick security check.</h1>
            <p>The code confirms that you control the email connected to your bookings and financial documents.</p>
            <ul className={styles.authBenefits}>
              <li>Six-digit, single-use verification code</li>
              <li>Automatic expiration for added protection</li>
              <li>Customer and administrator access remain separate</li>
            </ul>
            <Link href="/contact" className={styles.introLink}>Need help receiving the code? →</Link>
          </section>
          <Suspense fallback={null}><VerifyEmailForm /></Suspense>
        </div>
      </main>
    </div>
  );
}
