import type { AgreementDraft, ReservationDraft } from "@/src/types/reservationDraft";

export function patchAgreementDraft(draft: ReservationDraft, patch: Partial<AgreementDraft>): ReservationDraft {
  return { ...draft, agreement: { ...draft.agreement, ...patch } };
}
