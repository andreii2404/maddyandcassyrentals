import type { FulfillmentMethod } from "@/src/types/booking";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import styles from "./AgreementDocument.module.css";

export interface AgreementDocumentData {
  bookingRef: string;
  customerName: string;
  productName: string;
  quantity: number;
  brand: string;
  startDate: Date;
  endDate: Date;
  dayCount: number;
  fulfillmentMethod: FulfillmentMethod;
  customerLocation: string;
  pricePerDay: number;
  currency: string;
  includedAccessories: string[];
}

export { RENTAL_TERMS_VERSION as TERMS_VERSION } from "@/src/lib/rentalAgreement";

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
          <dt>Item</dt>
          <dd>
            {data.brand} — {data.productName}
          </dd>
        </div>
        <div>
          <dt>Quantity</dt>
          <dd>{data.quantity} {data.quantity === 1 ? "unit" : "units"}</dd>
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
        <div>
          <dt>Rental Rate</dt>
          <dd>
            {data.currency}
            {data.pricePerDay.toLocaleString()} / unit / day
          </dd>
        </div>
        <div className={styles.fullWidth}>
          <dt>Included Accessories</dt>
          <dd>{data.includedAccessories.join(", ")}</dd>
        </div>
      </dl>

      <section className={styles.termsSection}>
        <h4>Rental Terms &amp; Conditions</h4>
        <ol>
          <li>The rented item remains the property of Rental by Maddy &amp; Cassy at all times.</li>
          <li>
            The customer agrees to return the item on or before the agreed return date, at the
            agreed pickup location or delivery arrangement.
          </li>
          <li>
            The customer is responsible for the item&apos;s care during the rental period and
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
            non-refundable once payment is verified and the unit is reserved.
          </li>
          <li>
            The reservation is secured after our team verifies the initial GCash payment. The booking
            becomes fully confirmed after the required verification documents and this signed
            agreement are approved by the business.
          </li>
          <li>
            This agreement, once electronically signed, is considered binding for this specific
            booking.
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
