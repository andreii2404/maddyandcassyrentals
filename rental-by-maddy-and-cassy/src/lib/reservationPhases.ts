export type ReservationPhase = 1 | 2 | 3;

export interface ReservationPhaseCopy {
  number: ReservationPhase;
  label: string;
  title: string;
  description: string;
}

export const RESERVATION_PHASES: ReservationPhaseCopy[] = [
  { number: 1, label: "Reserve & Pay", title: "Reserve your rental and submit payment", description: "Choose your dates, share your details, and upload payment proof." },
  { number: 2, label: "Verification", title: "Verify your identity", description: "Submit your IDs, selfie, and emergency contact information." },
  { number: 3, label: "Agreement", title: "Review and sign the agreement", description: "Confirm the rental agreement with your full name and e-signature." },
];

export function reservationPhaseForStep(step: number): ReservationPhase {
  if (step <= 3) return 1;
  if (step === 4) return 2;
  return 3;
}

export function phaseCompletionLabel(phase: ReservationPhase, currentStep: number): string {
  const currentPhase = reservationPhaseForStep(currentStep);
  if (phase < currentPhase) return "Complete";
  if (phase === currentPhase) return "In progress";
  return "Up next";
}
