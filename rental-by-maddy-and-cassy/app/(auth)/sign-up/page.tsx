import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import SignUpForm from "./SignUpForm";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Create Account | Rental by Maddy & Cassy",
  description: "Create an account to reserve gear and manage your bookings.",
};

export default function SignUpPage() {
  return (
    <div>
      <main className={styles.main}>
        <div className={styles.authLayout}>
          <section className={styles.authIntro} aria-labelledby="create-account-heading">
            <p className={styles.introEyebrow}>START RENTING</p>
            <h1 id="create-account-heading">One verified account for every rental.</h1>
            <p>Create your customer profile once, then keep every reservation, receipt, invoice, and status update together.</p>
            <ul className={styles.authBenefits}>
              <li>Secure Gmail-based one-time-code access</li>
              <li>No password to remember for customer accounts</li>
              <li>Separate protected access for administrators</li>
            </ul>
            <Link href="/catalog" className={styles.introLink}>Explore available rentals →</Link>
          </section>
          <Suspense fallback={null}><SignUpForm /></Suspense>
        </div>
      </main>
    </div>
  );
}
