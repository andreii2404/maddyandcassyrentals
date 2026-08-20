"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import Spinner from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import {
  getAdminPayments,
  type AdminPaymentsData,
} from "@/src/services/operationsService";
import styles from "../operations.module.css";

function money(value: number) {
  return `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-PH") : "—";
}

export default function AdminPaymentsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<AdminPaymentsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!user) return;

    getAdminPayments()
      .then((records) => {
        if (active) setData(records);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Payment activity could not be loaded.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [user]);

  const payments = useMemo(
    () =>
      [...(data?.payments ?? [])].sort(
        (a, b) =>
          Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""),
      ),
    [data],
  );
  const paidRevenue = payments
    .filter((payment) => payment.status === "verified")
    .reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <AdminShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <p>PAYMENT OPERATIONS</p>
            <h1>Payments &amp; Webhooks</h1>
            <span>
              Review manually submitted GCash payments. Historic PayMongo transactions remain visible below.
            </span>
          </div>
        </header>
        {error ? <div className={styles.error}>{error}</div> : null}
        {!data && !error ? (
          <div className={styles.loading}>
            <Spinner size={28} label="Loading payments" />
          </div>
        ) : data ? (
          <>
            <section className={styles.metrics}>
              <article>
                <span>Recorded Revenue</span>
                <strong>{money(paidRevenue)}</strong>
              </article>
              <article>
                <span>Successful Payments</span>
                <strong>
                  {payments.filter((payment) => payment.status === "verified").length}
                </strong>
              </article>
              <article>
                <span>Pending Checkouts</span>
                <strong>
                  {
                    payments.filter(
                      (payment) => payment.status === "submitted" || payment.status === "under_review",
                    ).length
                  }
                </strong>
              </article>
              <article>
                <span>Webhook Events</span>
                <strong>{data.events.length}</strong>
              </article>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Payment Records</h2>
                  <p>Customer checkout and provider references.</p>
                </div>
              </div>
              {payments.length ? (
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Booking</th>
                        <th>Reference</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Mode</th>
                        <th>Method</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((payment) => (
                        <tr key={payment.id}>
                          <td>
                            <Link href={`/admin/bookings/${payment.bookingId}`}>
                              {payment.bookingId.slice(0, 8)}
                            </Link>
                          </td>
                          <td>
                            {payment.paymongoPaymentId || payment.externalReference || "—"}
                          </td>
                          <td>{money(payment.amount)}</td>
                          <td>
                            <span
                              className={`${styles.pill} ${styles[payment.status] ?? ""}`}
                            >
                              {payment.status}
                            </span>
                          </td>
                          <td>{payment.proofDocumentId ? "Manual" : "PayMongo"}</td>
                          <td>{payment.paymentMethod || "—"}</td>
                          <td>{formatDate(payment.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.empty}>No payment records yet.</p>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Legacy Webhook Log</h2>
                  <p>Historic signed PayMongo events from before the switch to manual GCash payments.</p>
                </div>
              </div>
              {data.events.length ? (
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Type</th>
                        <th>Signature</th>
                        <th>Status</th>
                        <th>Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.events]
                        .sort(
                          (a, b) =>
                            Date.parse(b.receivedAt || "") -
                            Date.parse(a.receivedAt || ""),
                        )
                        .map((event) => (
                          <tr key={event.id}>
                            <td>{event.providerEventId}</td>
                            <td>{event.eventType}</td>
                            <td>{event.signatureValid ? "Verified" : "Unverified"}</td>
                            <td>
                              <span
                                className={`${styles.pill} ${styles[event.processingStatus] ?? ""}`}
                              >
                                {event.processingStatus}
                              </span>
                            </td>
                            <td>
                              {event.paymentSubmissionId ? (
                                <span>{event.paymentSubmissionId.slice(0, 8)}</span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.empty}>
                  No webhook events on record.
                </p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
