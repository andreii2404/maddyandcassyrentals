"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { getUserProfile } from "@/src/services/userService";
import type { ReservationDraft } from "@/src/types/reservationDraft";

/** Initialize this booking's editable signing name from the current Profile once. */
export function useAgreementProfileName(
  isAgreementOpen: boolean,
  progressHydrated: boolean,
  userId: string,
  isGuest: boolean,
  setDraft: Dispatch<SetStateAction<ReservationDraft>>,
) {
  const initialized = useRef(false);

  useEffect(() => {
    if (!isAgreementOpen || !progressHydrated || isGuest || initialized.current) return;
    let cancelled = false;

    void getUserProfile(userId).then((profile) => {
      if (cancelled) return;
      initialized.current = true;
      const fullName = profile?.displayName?.trim() ?? "";
      if (!fullName) return;

      setDraft((current) =>
        current.agreement.typedFullName.trim()
          ? current
          : { ...current, agreement: { ...current.agreement, typedFullName: fullName } },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [isAgreementOpen, progressHydrated, userId, isGuest, setDraft]);
}
