"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import TrackBookingModal from "@/components/booking-lookup/TrackBookingModal";
import styles from "./Hero.module.css";

function TrackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
      <path d="M8.5 11h5M11 8.5v5" />
    </svg>
  );
}

/** Secondary hero CTA that opens the Track Booking modal. Hidden for admins, as it was in the navbar. */
export default function HeroTrackBooking() {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);

  if (isAdmin) return null;

  return (
    <>
      <Button
        variant="none"
        className={styles.secondaryButton}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <TrackIcon />
        Track Booking
      </Button>
      {open ? <TrackBookingModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
