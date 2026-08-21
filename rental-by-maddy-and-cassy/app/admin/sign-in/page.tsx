import type { Metadata } from "next";
import { Suspense } from "react";
import AdminSignInForm from "./AdminSignInForm";
import styles from "../../(auth)/auth.module.css";

export const metadata: Metadata = {
  title: "Admin Login | Rental by Maddy & Cassy",
  description: "Secure administrator access for rental operations.",
};

export default function AdminSignInPage() {
  return (
    <div>
      <main className={styles.main}>
        <div className={styles.authLayout}>
          <section className={styles.authIntro} aria-labelledby="admin-access-heading">
            <p className={styles.introEyebrow}>OPERATIONS PORTAL</p>
            <h1 id="admin-access-heading">Manage rentals with confidence.</h1>
            <p>
              Authorized staff can review bookings, verify submitted documents,
              manage catalog availability, and keep customer records organized.
            </p>
            <ul className={styles.authBenefits}>
              <li>Review the complete booking pipeline</li>
              <li>Verify payments, documents, and agreements</li>
              <li>Manage inventory and operational records</li>
            </ul>
            <p className={styles.securityNote}>Restricted to approved administrator accounts.</p>
          </section>
          <Suspense fallback={null}>
            <AdminSignInForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
