"use client";

import { Suspense } from "react";
import { BookingDetailContent } from "@/app/account/bookings/[bookingId]/page";
import Spinner from "@/components/ui/Spinner";

export default function GuestBookingTrackingPage() {
  return (
    <Suspense fallback={<Spinner label="Loading guest booking" />}>
      <BookingDetailContent guestMode />
    </Suspense>
  );
}
