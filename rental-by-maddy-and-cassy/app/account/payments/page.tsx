"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/src/lib/supabase/client";
import { getBookingsForUser } from "@/src/services/bookingService";
import { getBookingPayments } from "@/src/services/paymentService";
import type { Booking } from "@/src/types/booking";
import type { PaymentRecord } from "@/src/types/payment";
import { bookingHeadline } from "@/src/lib/bookingDisplay";
import Spinner from "@/components/ui/Spinner";
import styles from "./payments.module.css";

interface PaymentRow {
  booking: Booking;
  payment: PaymentRecord;
}

function money(value: number): string {
  return `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PaymentHistoryPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const supabase = createClient();
    getBookingsForUser(supabase, user.id)
      .then(async (bookings) => {
        const payments = await Promise.all(
          bookings.map(async (booking) => ({
            booking,
            payments: await getBookingPayments(supabase, booking.id),
          })),
        );
        if (active) {
          setRows(
            payments.flatMap(({ booking, payments: bookingPayments }) =>
              bookingPayments.map((payment) => ({ booking, payment })),
            ),
          );
        }
      })
      .catch(() => {
        if (active) setError("Your payment history could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [user]);

  const orderedRows = useMemo(
    () =>
      [...(rows ?? [])].sort(
        (left, right) => new Date(right.payment.createdAt).getTime() - new Date(left.payment.createdAt).getTime(),
      ),
    [rows],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>PAYMENT RECORDS</p>
          <h1>Payment History</h1>
          <span>Track your GCash payment submissions and verified payments.</span>
        </div>
        <Link href="/account/bookings">Back to bookings</Link>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {!rows && !error ? (
        <div className={styles.loading}>
          <Spinner size={28} label="Loading payment history" />
        </div>
      ) : orderedRows.length ? (
        <div className={styles.list}>
          {orderedRows.map(({ booking, payment }) => (
            <article key={`${booking.id}-${payment.id}`} className={styles.card}>
              <div>
                <Link href={`/account/bookings/${booking.id}`}>{booking.bookingRef}</Link>
                <p>{bookingHeadline(booking.items)}</p>
                <small>{new Date(payment.createdAt).toLocaleString("en-PH")}</small>
              </div>
              <div className={styles.payment}>
                <strong>{money(payment.amount)}</strong>
                <small>
                  {(payment.providerMetadata as { demo?: boolean } | undefined)?.demo
                    ? "Demo checkout preview — no charge"
                    : payment.stage === "down_payment"
                      ? "50% reservation payment"
                      : payment.stage === "balance"
                        ? "Remaining balance"
                        : "Full payment"}
                </small>
                <span className={`${styles.status} ${styles[payment.status]}`}>
                  {payment.status}
                </span>
                <small>{payment.externalReference}</small>
              </div>
            </article>
          ))}
        </div>
      ) : rows ? (
        <div className={styles.empty}>
          <h2>No payment records yet</h2>
          <p>Your checkout, proof, and receipt history will appear here after you reserve an item.</p>
        </div>
      ) : null}
    </div>
  );
}
