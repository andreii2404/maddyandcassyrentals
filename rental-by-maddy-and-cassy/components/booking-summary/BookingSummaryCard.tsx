import Image from "next/image";
import type { FulfillmentMethod } from "@/src/types/booking";
import { formatManilaDateTime } from "@/src/lib/rentalTiming";
import styles from "./BookingSummaryCard.module.css";

export interface BookingSummaryCardProps {
  bookingRef?: string;
  productName: string;
  brand: string;
  productImage: string;
  pricePerDay: number;
  currency: string;
  startDate: Date;
  endDate: Date;
  dayCount: number;
  quantity?: number;
  fulfillmentMethod: FulfillmentMethod;
  customerLocation: string;
  statusSlot?: React.ReactNode;
  /** "list" gives booking-history rows a scannable layout; "default" keeps the compact review look. */
  variant?: "default" | "list";
}

export default function BookingSummaryCard({
  bookingRef,
  productName,
  brand,
  productImage,
  pricePerDay,
  currency,
  startDate,
  endDate,
  dayCount,
  quantity = 1,
  fulfillmentMethod,
  customerLocation,
  statusSlot,
  variant = "default",
}: BookingSummaryCardProps) {
  const safeProductImage = productImage.trim() || "/images/product-placeholder.png";
  const isList = variant === "list";

  return (
    <div className={isList ? `${styles.card} ${styles.cardList}` : styles.card}>
      <div className={styles.imageWrapper}>
        <Image src={safeProductImage} alt={productName} fill sizes={isList ? "88px" : "72px"} />
      </div>

      <div className={styles.info}>
        <div className={styles.topRow}>
          <div>
            {bookingRef ? <p className={styles.ref}>{bookingRef}</p> : null}
            <p className={styles.brand}>{brand}</p>
            <h3 className={styles.name}>{productName}</h3>
          </div>
          {statusSlot}
        </div>

        <dl className={styles.detailGrid}>
          <div>
            <dt>Pickup</dt>
            <dd>{formatManilaDateTime(startDate)}</dd>
          </div>
          <div>
            <dt>Return</dt>
            <dd>{formatManilaDateTime(endDate)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{dayCount === 1 ? "22 hours" : `${dayCount} days`}</dd>
          </div>
          <div>
            <dt>Quantity</dt>
            <dd>{quantity} {quantity === 1 ? "unit" : "units"}</dd>
          </div>
          <div>
            <dt>Fulfillment</dt>
            <dd>{fulfillmentMethod === "pickup" ? "Pickup" : "Delivery"}</dd>
          </div>
          <div className={styles.detailWide}>
            <dt>Location</dt>
            <dd>{customerLocation}</dd>
          </div>
          <div>
            <dt>Daily Rate</dt>
            <dd>
              {currency}
              {pricePerDay.toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
