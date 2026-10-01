import styles from "./ReservationStepper.module.css";
import { phaseCompletionLabel, reservationPhaseForStep, RESERVATION_PHASES } from "@/src/lib/reservationPhases";

interface ReservationStepperProps { steps: string[]; currentStep: number; }

export default function ReservationStepper({ steps, currentStep }: ReservationStepperProps) {
  const currentPhase = reservationPhaseForStep(currentStep);
  // The last step is the submitted confirmation: every phase is done and the
  // final "Submitted" marker becomes the current step.
  const finished = currentStep >= steps.length;
  return (
    <nav className={styles.progress} aria-label="Reservation progress">
      <p className={styles.mobileCurrent} aria-live="polite">
        {finished ? (
          <>
            <span>All phases complete · Step {currentStep} of {steps.length}</span>
            <strong>Request submitted</strong>
          </>
        ) : (
          <>
            <span>Phase {currentPhase} of {RESERVATION_PHASES.length} · Step {currentStep} of {steps.length}</span>
            <strong>{RESERVATION_PHASES[currentPhase - 1].label}</strong>
          </>
        )}
      </p>
      <ol className={styles.stepper}>
        {RESERVATION_PHASES.map((phase) => {
          const isCompleted = finished || phase.number < currentPhase;
          const isCurrent = !finished && phase.number === currentPhase;
          return (
            <li key={phase.number} className={`${styles.step} ${isCurrent ? styles.current : ""} ${isCompleted ? styles.completed : ""}`} aria-current={isCurrent ? "step" : undefined}>
              <span className={styles.indicator} aria-hidden="true">{isCompleted ? "✓" : phase.number}</span>
              <span className={styles.label}>{phase.label}</span>
              <small className={styles.phaseStatus}>{finished ? "Complete" : phaseCompletionLabel(phase.number, currentStep)}</small>
            </li>
          );
        })}
        {finished ? (
          <li className={`${styles.step} ${styles.current} ${styles.final}`} aria-current="step">
            <span className={styles.indicator} aria-hidden="true">✓</span>
            <span className={styles.label}>Submitted</span>
            <small className={styles.phaseStatus}>Pending verification</small>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
