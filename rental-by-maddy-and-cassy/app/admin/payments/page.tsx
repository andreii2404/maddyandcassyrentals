"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import Spinner from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import {
  getAdminPayments,
  getAdminPaymentProofUrl,
  reviewManualPayment,
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
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotesById, setReviewNotesById] = useState<Record<string, string>>({});

  async function openProof(paymentId: string) {
    try {
      const url = await getAdminPaymentProofUrl(paymentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (proofError) {
      setError(proofError instanceof Error ? proofError.message : "The payment proof could not be opened.");
    }
  }

  async function reviewPayment(paymentId: string, action: "verify" | "reject") {
    const notes = reviewNotesById[paymentId]?.trim() ?? "";
    if (action === "reject" && notes.length < 5) {
      setError("Add a clear rejection reason before rejecting the payment proof.");
      return;
    }
    setReviewingId(paymentId);
    setError(null);
    try {
      await reviewManualPayment(paymentId, action, notes);
      setData(await getAdminPayments());
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "The payment review could not be completed.");
    } finally {
      setReviewingId(null);
    }
  }

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
            <h1>GCash Payment Verification</h1>
            <span>
              Review customer GCash receipts, verify matching transactions, and issue official receipts.
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
                <span>Proofs to Review</span>
                <strong>
                  {
                    payments.filter(
                      (payment) => payment.status === "submitted" || payment.status === "under_review",
                    ).length
                  }
                </strong>
              </article>
              <article>
                <span>Rejected Proofs</span>
                <strong>{payments.filter((payment) => payment.status === "rejected").length}</strong>
              </article>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Payment Records</h2>
                  <p>Customer-submitted GCash references and proof review.</p>
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
                        <th>Proof</th>
                        <th>Method</th>
                        <th>Created</th>
                        <th>Review</th>
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
                            {payment.externalReference || payment.paymongoPaymentId || "—"}
                          </td>
                          <td>{money(payment.amount)}</td>
                          <td>
                            <span
                              className={`${styles.pill} ${styles[payment.status] ?? ""}`}
                            >
                              {payment.status}
                            </span>
                          </td>
                          <td>{payment.proofDocumentId ? <button type="button" onClick={() => void openProof(payment.id)}>Open proof</button> : "Legacy online"}</td>
                          <td>{payment.paymentMethod || "—"}</td>
                          <td>{formatDate(payment.createdAt)}</td>
                          <td>
                            {payment.proofDocumentId && ["submitted", "under_review"].includes(payment.status) ? (
                              <div className={styles.rowActions}>
                                <input
                                  value={reviewNotesById[payment.id] ?? ""}
                                  onChange={(event) => setReviewNotesById((current) => ({ ...current, [payment.id]: event.target.value }))}
                                  placeholder="Review note (required to reject)"
                                  aria-label={`Review note for payment ${payment.externalReference ?? payment.id}`}
                                />
                                <button type="button" disabled={reviewingId === payment.id} onClick={() => void reviewPayment(payment.id, "verify")}>Verify</button>
                                <button type="button" disabled={reviewingId === payment.id} onClick={() => void reviewPayment(payment.id, "reject")}>Reject</button>
                              </div>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.empty}>No payment records yet.</p>
              )}
            </section>

            {data.events.length ? <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Legacy PayMongo Webhook Archive</h2>
                  <p>Read-only historical events from the previous payment integration.</p>
                </div>
              </div>
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
            </section> : null}
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
