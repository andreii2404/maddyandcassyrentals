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
  return `${currency}${value.toLocaleString()}`;
}

export default function AgreementDocument({ data }: { data: AgreementDocumentData }) {
  return (
    <div className={styles.document}>
      <header className={styles.header}>
        <h3 className={styles.title}>Rental Agreement</h3>
        <p className={styles.ref}>Booking Reference: {data.bookingRef}</p>
      </header>

      <dl className={styles.detailGrid}>
        <div>
          <dt>Customer</dt>
          <dd>{data.customerName}</dd>
        </div>
        <div>
          <dt>Pickup &amp; Return</dt>
          <dd>
            {formatManilaDateTime(data.startDate)} – {formatManilaDateTime(data.endDate)} (
            {data.dayCount === 1 ? "22 hours" : `${data.dayCount} days`})
          </dd>
        </div>
        <div>
          <dt>Fulfillment</dt>
          <dd>{data.fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}</dd>
        </div>
        <div>
          <dt>Customer Location</dt>
          <dd>{data.customerLocation}</dd>
        </div>
      </dl>

      <section className={styles.itemsSection}>
        <h4>Rented Items</h4>
        {data.items.map((item, index) => (
          <div key={`${item.productName}-${index}`} className={styles.itemBlock}>
            <div className={styles.itemHeaderRow}>
              <strong>
                {item.brand ? `${item.brand} — ` : ""}
                {item.productName}
              </strong>
              <span>{money(data.currency, item.lineTotal)}</span>
            </div>
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
                <dt>Line total</dt>
                <dd>{money(data.currency, item.lineTotal)}</dd>
              </div>
            </dl>
            {item.includedAccessories.length > 0 ? (
              <p className={styles.itemAccessories}>
                Included: {item.includedAccessories.join(", ")}
              </p>
            ) : null}
            <div className={styles.unitList}>
              <span className={styles.unitListLabel}>
                Assigned {item.units.length === 1 ? "unit" : "units"}
              </span>
              {item.units.length > 0 ? (
                <ul>
                  {item.units.map((unit) => (
                    <li key={unit.unitCode}>
                      {unit.unitCode}
                      {unit.serialNumber ? ` — Serial ${unit.serialNumber}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.unitListPending} role="status">
                  Confirming assigned unit(s)…
                </p>
              )}
            </div>
          </div>
        ))}
      </section>

      <dl className={styles.totalsGrid}>
        <div>
          <dt>Subtotal</dt>
          <dd>{money(data.currency, data.subtotal)}</dd>
        </div>
        {data.discountAmount > 0 ? (
          <div>
            <dt>Discounts</dt>
            <dd>-{money(data.currency, data.discountAmount)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Refundable deposit</dt>
          <dd>{money(data.currency, data.depositAmount)}</dd>
        </div>
        {data.fees > 0 ? (
          <div>
            <dt>Other fees</dt>
            <dd>{money(data.currency, data.fees)}</dd>
          </div>
        ) : null}
        <div className={styles.totalRow}>
          <dt>Final amount</dt>
          <dd>{money(data.currency, data.finalAmount)}</dd>
        </div>
      </dl>

      <section className={styles.termsSection}>
        <h4>Rental Terms &amp; Conditions</h4>
        <ol>
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

        <h4>Privacy Notice</h4>
        <p>
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
