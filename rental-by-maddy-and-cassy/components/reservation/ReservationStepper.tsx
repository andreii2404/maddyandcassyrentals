import styles from "./ReservationStepper.module.css";
import { phaseCompletionLabel, reservationPhaseForStep, RESERVATION_PHASES } from "@/src/lib/reservationPhases";

interface ReservationStepperProps { steps: string[]; currentStep: number; }

export default function ReservationStepper({ steps, currentStep }: ReservationStepperProps) {
  const currentPhase = reservationPhaseForStep(currentStep);
  return (
    <nav className={styles.progress} aria-label="Reservation progress">
      <p className={styles.mobileCurrent} aria-live="polite">
        <span>Phase {currentPhase} of {RESERVATION_PHASES.length} · Step {currentStep} of {steps.length}</span>
        <strong>{RESERVATION_PHASES[currentPhase - 1].label}</strong>
      </p>
      <ol className={styles.stepper}>
        {RESERVATION_PHASES.map((phase) => {
          const isCompleted = phase.number < currentPhase;
          const isCurrent = phase.number === currentPhase;
          return (
            <li key={phase.number} className={`${styles.step} ${isCurrent ? styles.current : ""} ${isCompleted ? styles.completed : ""}`} aria-current={isCurrent ? "step" : undefined}>
              <span className={styles.indicator} aria-hidden="true">{isCompleted ? "✓" : phase.number}</span>
              <span className={styles.label}>{phase.label}</span>
              <small className={styles.phaseStatus}>{phaseCompletionLabel(phase.number, currentStep)}</small>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
