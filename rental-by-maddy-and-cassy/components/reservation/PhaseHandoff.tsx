import { Button } from "@/components/ui/Button";
import { RESERVATION_PHASES } from "@/src/lib/reservationPhases";
import styles from "./PhaseHandoff.module.css";

export default function PhaseHandoff({ phase, bookingNumber, isGuest = false, onContinue, onLeave }: { phase: 1 | 2; bookingNumber?: string | null; isGuest?: boolean; onContinue: () => void; /** Overrides the default full-page redirect, e.g. to confirm leaving checkout first. */ onLeave?: (href: string) => void }) {
  const copy = RESERVATION_PHASES[phase - 1];
  const isPayment = phase === 1;
  const bookingsHref = isGuest ? "/guest/bookings" : "/account/bookings";
  return (
    <section className={styles.wrapper} aria-labelledby="phase-handoff-heading">
      <div className={styles.icon} aria-hidden="true">✓</div>
      <p className={styles.eyebrow}>PHASE {phase} COMPLETE</p>
      <h2 id="phase-handoff-heading">{isPayment ? "Reservation Submitted — You’re done for now." : "Verification Submitted — You’re done for now."}</h2>
      {bookingNumber ? <p className={styles.reference}>Reservation {bookingNumber}</p> : null}
      <p className={styles.message}>{isPayment ? "Your schedule, customer details, and payment proof are saved for the team to review." : "Your verification details are saved for the team to review. Keep your reference handy if you return later."}</p>
      {isPayment ? <div className={styles.warning} role="note"><strong>Your rental dates are not secured yet.</strong><span>Dates become secured only after payment and verification are approved by the team.</span></div> : null}
      <p className={styles.returnNote}>You can leave now and return from <strong>My Bookings</strong> (or Guest Bookings) to continue when you&apos;re ready.</p>
      <div className={styles.actions}>
        <Button type="button" variant="primary" onClick={onContinue}>Continue to {isPayment ? "Verification" : "Agreement"}</Button>
        <Button type="button" variant="secondary" onClick={() => (onLeave ? onLeave(bookingsHref) : window.location.assign(bookingsHref))}>Save and leave</Button>
      </div>
      <small className={styles.nextHint}>Next: {copy.label} · {copy.description}</small>
    </section>
  );
}
