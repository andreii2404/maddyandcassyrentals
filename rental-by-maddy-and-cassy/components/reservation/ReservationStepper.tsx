import styles from "./ReservationStepper.module.css";

interface ReservationStepperProps {
  steps: string[];
  currentStep: number;
}

export default function ReservationStepper({ steps, currentStep }: ReservationStepperProps) {
  return (
    <nav className={styles.progress} aria-label="Reservation progress">
      <p className={styles.mobileCurrent} aria-live="polite">
        <span>Step {currentStep} of {steps.length}</span>
        <strong>{steps[currentStep - 1]}</strong>
      </p>
      <ol className={styles.stepper}>
        {steps.map((label, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;

          return (
            <li
              key={label}
              className={`${styles.step} ${isCurrent ? styles.current : ""} ${
                isCompleted ? styles.completed : ""
              }`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className={styles.indicator} aria-hidden="true">
                {isCompleted ? "✓" : stepNumber}
              </span>
              <span className={styles.label}>{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
