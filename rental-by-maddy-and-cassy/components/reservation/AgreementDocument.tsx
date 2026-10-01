import type { FulfillmentMethod } from "@/src/types/booking";
import type { AgreementLineItem } from "@/src/types/booking";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import styles from "./AgreementDocument.module.css";

export interface AgreementDocumentData {
  bookingRef: string;
  customerName: string;
  /** Every product on this booking -- a single-item booking passes a 1-entry array. */
  items: AgreementLineItem[];
  startDate: Date;
  endDate: Date;
  dayCount: number;
  fulfillmentMethod: FulfillmentMethod;
  customerLocation: string;
  currency: string;
  subtotal: number;
  discountAmount: number;
  depositAmount: number;
  fees: number;
  finalAmount: number;
}

export { RENTAL_TERMS_VERSION as TERMS_VERSION } from "@/src/lib/rentalAgreement";

function money(currency: string, value: number): string {
  return `${currency} ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function manilaDate(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function manilaTime(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function ScheduleMoment({ label, value }: { label: string; value: Date }) {
  const date = manilaDate(value);
  const time = manilaTime(value);
  return (
    <div className={styles.scheduleMoment}>
      <dt>{label}</dt>
      <dd>
        {date && time ? (
          <>
            <span className={styles.scheduleDate}>{date}</span>
            <span className={styles.scheduleTime}>{time}</span>
          </>
        ) : (
          <span className={styles.scheduleDate}>{formatManilaDateTime(value)}</span>
        )}
      </dd>
    </div>
  );
}

export default function AgreementDocument({
  data,
  variant = "compact",
}: {
  data: AgreementDocumentData;
  /** "expanded" drops the internal scroll cap so the full-screen modal controls scrolling instead. */
  variant?: "compact" | "expanded";
}) {
  return (
    <div className={variant === "expanded" ? styles.documentExpanded : styles.document}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>Rental Agreement</h3>
          <p className={styles.subtitle}>
            Please review your booking details, payment summary, and terms before signing.
          </p>
        </div>
        <p className={styles.ref}>
          <span className={styles.refLabel}>Booking Reference</span>
          <span className={styles.refValue}>{data.bookingRef}</span>
        </p>
      </header>

      <section className={styles.section}>
        <h4 className={styles.sectionHeading}>
          <span className={styles.sectionNumber} aria-hidden="true">1</span>
          Booking Summary
        </h4>
        <dl className={styles.summaryGrid}>
          <div className={styles.summaryGroup}>
            <dt>Customer</dt>
            <dd>{data.customerName}</dd>
          </div>
          <div className={`${styles.summaryGroup} ${styles.summaryGroupWide}`}>
            <dt>Pickup &amp; Return</dt>
            <dd>
              <dl className={styles.scheduleList}>
                <ScheduleMoment label="Pickup" value={data.startDate} />
                <ScheduleMoment label="Return deadline" value={data.endDate} />
              </dl>
              <p className={styles.scheduleDuration}>
                Rental period: {data.dayCount === 1 ? "22 hours" : `${data.dayCount} days`}
              </p>
            </dd>
          </div>
          <div className={styles.summaryGroup}>
            <dt>Fulfillment</dt>
            <dd>{data.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}</dd>
          </div>
          <div className={styles.summaryGroup}>
            <dt>Customer Location</dt>
            <dd>{data.customerLocation}</dd>
          </div>
        </dl>
        <ul className={styles.scheduleNote}>
          <li>Rental days end at 11:59 PM on the final selected rental date.</li>
          <li>The item must be returned within the following 22-hour return window.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionHeading}>
          <span className={styles.sectionNumber} aria-hidden="true">2</span>
          Rented Items
        </h4>
        <ul className={styles.itemList}>
          {data.items.map((item, index) => (
            <li key={`${item.productName}-${index}`} className={styles.item}>
              <strong className={styles.itemName}>
                {item.brand ? `${item.brand} — ` : ""}
                {item.productName}
              </strong>
              <dl className={styles.itemDetailGrid}>
                <div>
                  <dt>Quantity</dt>
                  <dd>{item.quantity} {item.quantity === 1 ? "unit" : "units"}</dd>
                </div>
                <div>
                  <dt>Rate</dt>
                  <dd>{money(data.currency, item.pricePerDay)} / unit / day</dd>
                </div>
                <div>
                  <dt>Rental days</dt>
                  <dd>{item.rentalDays}</dd>
                </div>
                <div>
                  <dt>Assigned {item.units.length === 1 ? "unit" : "units"}</dt>
                  <dd>
                    {item.units.length > 0 ? (
                      <ul className={styles.unitList}>
                        {item.units.map((unit) => (
                          <li key={unit.unitCode}>
                            {unit.unitCode}
                            {unit.serialNumber ? (
                              <span className={styles.unitSerial}> — Serial {unit.serialNumber}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className={styles.unitListPending} role="status">
                        Confirming assigned unit(s)…
                      </span>
                    )}
                  </dd>
                </div>
                <div className={styles.lineTotal}>
                  <dt>Line total</dt>
                  <dd>{money(data.currency, item.lineTotal)}</dd>
                </div>
              </dl>
              {item.includedAccessories.length > 0 ? (
                <p className={styles.itemAccessories}>
                  <span>Included:</span> {item.includedAccessories.join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionHeading}>
          <span className={styles.sectionNumber} aria-hidden="true">3</span>
          Payment Summary
        </h4>
        <dl className={styles.totalsList}>
          <div className={styles.totalsRow}>
            <dt>Rental subtotal</dt>
            <dd>{money(data.currency, data.subtotal)}</dd>
          </div>
          {data.discountAmount > 0 ? (
            <div className={styles.totalsRow}>
              <dt>Discounts</dt>
              <dd>-{money(data.currency, data.discountAmount)}</dd>
            </div>
          ) : null}
          <div className={styles.totalsRow}>
            <dt>Refundable deposit</dt>
            <dd>{money(data.currency, data.depositAmount)}</dd>
          </div>
          {data.fees > 0 ? (
            <div className={styles.totalsRow}>
              <dt>Other applicable charges</dt>
              <dd>{money(data.currency, data.fees)}</dd>
            </div>
          ) : null}
          <div className={styles.finalRow}>
            <dt>Final amount</dt>
            <dd>{money(data.currency, data.finalAmount)}</dd>
          </div>
        </dl>
      </section>

      <section className={`${styles.section} ${styles.termsSection}`}>
        <h4 className={styles.sectionHeading}>
          <span className={styles.sectionNumber} aria-hidden="true">4</span>
          Rental Terms &amp; Conditions
        </h4>
        <ol className={styles.termsList}>
          <li>Every rented item remains the property of Rental by Maddy &amp; Cassy at all times.</li>
          <li>
            The customer agrees to return every item on or before the agreed return date, at the
            agreed pickup location or delivery arrangement.
          </li>
          <li>
            The customer is responsible for each item&apos;s care during the rental period and
            agrees to use it only for its intended purpose.
          </li>
          <li>
            Late returns may result in additional charges to be discussed and arranged directly
            with the business.
          </li>
          <li>
            Any damage, loss, or missing accessories will be assessed by the business, and the
            customer agrees to cooperate in resolving any related costs directly with the
            business.
          </li>
          <li>
            The reservation payment and any deposit shown in the checkout summary are
            non-refundable once payment is verified and the units are reserved.
          </li>
          <li>
            The reservation is secured after our team verifies the initial GCash payment. The booking
            becomes fully confirmed after the required verification documents and this signed
            agreement are approved by the business.
          </li>
          <li>
            This agreement, once electronically signed, is considered binding for this specific
            booking and every item listed above.
          </li>
        </ol>
      </section>

      <section className={`${styles.section} ${styles.termsSection}`}>
        <h4 className={styles.sectionHeading}>
          <span className={styles.sectionNumber} aria-hidden="true">5</span>
          Privacy Notice
        </h4>
        <p className={styles.termsParagraph}>
          The personal information, identification documents, and photos you submit are collected
          solely to verify your identity and process this rental booking. Your information is
          stored securely and is only accessible to you and authorized personnel of Rental by
          Maddy &amp; Cassy. It will not be shared with third parties except as required to
          fulfill this rental agreement.
        </p>
      </section>
    </div>
  );
}
