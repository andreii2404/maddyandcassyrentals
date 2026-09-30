"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Modal from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { friendlyMessage } from "@/src/lib/friendlyMessage";
import { startGuestCheckout } from "@/src/services/authService";
import styles from "./CheckoutAccessDialog.module.css";

interface CheckoutAccessDialogProps {
  /** Where to land once a session exists. Also the post-sign-in redirect. */
  redirectPath?: string;
  onClose: () => void;
}

/**
 * Shown when a visitor with no session starts checkout. Guest booking access
 * lives here -- inside the checkout flow -- rather than in the navbar, so the
 * lookup is only offered to people who actually chose to book as a guest.
 */
export default function CheckoutAccessDialog({
  redirectPath = "/checkout",
  onClose,
}: CheckoutAccessDialogProps) {
  const router = useRouter();
  const [startingGuest, setStartingGuest] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);
  const authRedirect = `?redirect=${encodeURIComponent(redirectPath)}`;

  async function handleGuestCheckout() {
    setStartingGuest(true);
    setGuestError(null);
    try {
      await startGuestCheckout();
      router.push(redirectPath);
    } catch (error) {
      setGuestError(
        friendlyMessage(
          error instanceof Error ? error.message : "Guest checkout could not be started.",
          "error",
        ),
      );
      setStartingGuest(false);
    }
  }

  return (
    <Modal title="Check out with or without an account" onClose={onClose} describedBy="checkout-access-intro">
      <p id="checkout-access-intro" className={styles.intro}>
        Guest checkout keeps this booking on the current browser. Signing in is recommended if you
        want permanent access to your bookings, payment history, and receipts on other devices.
      </p>

      <div className={styles.options}>
        <div className={styles.option}>
          <strong>Guest Checkout</strong>
          <p>
            No account required. You will still provide an email for booking updates, and you can
            track this booking from the confirmation page afterwards.
          </p>
          <Button
            variant="none"
            className={styles.primaryAction}
            disabled={startingGuest}
            onClick={handleGuestCheckout}
          >
            {startingGuest ? "Starting guest checkout…" : "Continue as Guest"}
          </Button>
        </div>

        <div className={styles.option}>
          <strong>Login</strong>
          <div className={styles.benefits}>
            <p>Signed-in customers can track, from any device:</p>
            <ul>
              <li>Booking history</li>
              <li>Payment history</li>
              <li>Receipts and invoices</li>
              <li>Loyalty reward progress</li>
            </ul>
          </div>
          <Link href={`/sign-in${authRedirect}`} className={styles.primaryAction}>Login</Link>
          <p className={styles.signUpPrompt}>
            Don&apos;t have an account?{" "}
            <Link href={`/sign-up${authRedirect}`} className={styles.signUpLink}>Create an account</Link>
          </p>
        </div>
      </div>

      {guestError ? <p className={styles.error} role="alert">{guestError}</p> : null}
    </Modal>
  );
}
