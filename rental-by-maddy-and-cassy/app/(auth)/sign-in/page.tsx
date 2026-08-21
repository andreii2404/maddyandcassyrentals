import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import SignInForm from "./SignInForm";
import styles from "../auth.module.css";

export const metadata: Metadata = {
  title: "Customer Sign In | Rental by Maddy & Cassy",
  description: "Customer sign in for rental reservations and booking updates.",
};

export default function SignInPage() {
  return (
    <div>
      <main className={styles.main}>
        <div className={styles.authLayout}>
          <section className={styles.authIntro} aria-labelledby="customer-access-heading">
            <p className={styles.introEyebrow}>CUSTOMER ACCOUNT</p>
            <h1 id="customer-access-heading">Your rentals, all in one place.</h1>
            <p>
              Sign in securely to continue a reservation, submit requirements,
              and follow every booking update from one clear dashboard.
            </p>
            <ul className={styles.authBenefits}>
              <li>Track reservations and booking status</li>
              <li>Access payment history, receipts, and invoices</li>
              <li>Return to saved booking steps without starting over</li>
            </ul>
            <Link href="/catalog" className={styles.introLink}>Browse the catalog first →</Link>
          </section>
          <Suspense fallback={null}>
            <SignInForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
