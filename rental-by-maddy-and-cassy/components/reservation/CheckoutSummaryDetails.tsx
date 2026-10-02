"use client";

import Link from "next/link";
import type { Product } from "@/types/product";
import type { FulfillmentMethod } from "@/src/types/booking";
import type { MultiItemReservationPricing } from "@/src/lib/reservationPricing";
import { formatPeso } from "@/src/lib/emailShell";
import {
  DELIVERY_TRANSPORT_ALLOWANCE_HOURS,
  formatManilaDateTime,
  formatManilaPickupTime,
  isOutsideNormalPickupWindow,
  pickupDateKey,
  RENTAL_DURATION_HOURS,
} from "@/src/lib/rentalTiming";
import styles from "./StepRentalDetails.module.css";

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Time only when it falls on the same Manila day as `reference`; otherwise the full date and time. */
function sameDayTimeLabel(value: Date, reference: Date): string {
  return pickupDateKey(value) === pickupDateKey(reference)
    ? formatManilaPickupTime(value)
    : formatManilaDateTime(value);
}

function handoverNoun(method: FulfillmentMethod | null): string {
  if (method === "pickup") return "pickup";
  if (method === "delivery") return "delivery";
  return "pickup/delivery";
}

interface PriceBreakdownProps {
  lines: { product: Pick<Product, "id" | "name" | "listPricePerDay">; quantity: number; color?: string }[];
  pricing: MultiItemReservationPricing;
  fulfillmentMethod: FulfillmentMethod | null;
  pickupTime: string;
}

/**
 * Collapsible line-by-line view of the live checkout pricing. Every amount comes
 * straight from `pricing` (calculateMultiItemReservationPricing), so the rows
 * always add up to the Estimated total shown beneath it.
 */
export function PriceBreakdown({ lines, pricing, fulfillmentMethod, pickupTime }: PriceBreakdownProps) {
  const hasDates = pricing.rentalDays > 0;
  const convenienceFeeReason =
    pickupTime && isOutsideNormalPickupWindow(pickupTime)
      ? Number(pickupTime.slice(0, 2)) < 9
        ? "before 9:00 AM"
        : "after 7:00 PM"
      : null;

  return (
    <details className={styles.summaryDetails}>
      <summary>
        <span className={styles.summaryDetailsLabel}>Price breakdown</span>
        <span className={styles.summaryDetailsValue}>
          {hasDates ? plural(pricing.rentalDays, "day") : "Choose dates"}
        </span>
      </summary>

      <div className={styles.summaryDetailsBody}>
        {!hasDates ? (
          <p className={styles.summaryDetailsNote}>
            Choose your rental dates and pickup or delivery time to see the full price breakdown.
          </p>
        ) : (
          <>
            <ul className={styles.breakdownItems}>
              {pricing.lines.map((line, index) => {
                const cartLine = lines[index];
                const listRate = cartLine?.product.listPricePerDay ?? line.pricePerDay;
                return (
                  <li key={line.productId}>
                    <span className={styles.breakdownItemName}>
                      {line.productName}
                      {cartLine?.color ? ` — ${cartLine.color}` : ""}
                    </span>
                    <span className={styles.breakdownFormula}>
                      {formatPeso(line.pricePerDay)}/day × {plural(line.quantity, "unit")} ×{" "}
                      {plural(line.rentalDays, "day")} = <strong>{formatPeso(line.lineTotal)}</strong>
                    </span>
                    {line.lineListTotal > line.lineTotal ? (
                      <span className={styles.breakdownHint}>
                        Sale rate applied (regular {formatPeso(listRate)}/day)
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <dl className={styles.breakdownRows}>
              <div className={styles.breakdownSubtotal}>
                <dt>Products subtotal</dt>
                <dd>{formatPeso(pricing.productSubtotal)}</dd>
              </div>

              <div>
                <dt>Discounts</dt>
                <dd className={pricing.specialDiscountAmount > 0 ? styles.breakdownDiscount : undefined}>
                  {pricing.specialDiscountAmount > 0 ? `−${formatPeso(pricing.specialDiscountAmount)}` : "None applied"}
                </dd>
              </div>

              <div className={styles.breakdownSubtotal}>
                <dt>Rental subtotal</dt>
                <dd>{formatPeso(pricing.rentalSubtotal)}</dd>
              </div>

              <div>
                <dt>
                  Refundable security deposit
                  <small>Returned after the items pass inspection</small>
                </dt>
                <dd>{formatPeso(pricing.depositAmount)}</dd>
              </div>

              <div>
                <dt>
                  Delivery / courier fee
                  {fulfillmentMethod === "delivery" ? (
                    <small>You book your courier and pay the courier directly. It is separate from the rental fee.</small>
                  ) : null}
                </dt>
                <dd>
                  {fulfillmentMethod === "pickup"
                    ? `${formatPeso(0)} (pickup)`
                    : fulfillmentMethod === "delivery"
                      ? "Not included"
                      : "Choose pickup or delivery"}
                </dd>
              </div>

              {pricing.fees > 0 ? (
                <div>
                  <dt>
                    Convenience / late-time fee
                    <small>
                      Added because your {handoverNoun(fulfillmentMethod)} time is{" "}
                      {convenienceFeeReason ?? "outside 9:00 AM–7:00 PM"}. Regular hours are 9:00 AM–7:00 PM.
                    </small>
                  </dt>
                  <dd>{formatPeso(pricing.fees)}</dd>
                </div>
              ) : null}

              {pricing.sameDayFee > 0 ? (
                <div>
                  <dt>
                    Same-day convenience fee
                    <small>Added because your rental starts today. Advance bookings have no fee.</small>
                  </dt>
                  <dd>{formatPeso(pricing.sameDayFee)}</dd>
                </div>
              ) : null}

              {pricing.fees <= 0 && pricing.sameDayFee <= 0 ? (
                <div>
                  <dt>Additional fees</dt>
                  <dd>None</dd>
                </div>
              ) : null}
            </dl>

            {pricing.catalogDiscountAmount > 0 ? (
              <p className={styles.breakdownHint}>
                Sale savings of {formatPeso(pricing.catalogDiscountAmount)} are already included in the
                daily rates above.
              </p>
            ) : null}
          </>
        )}
      </div>
    </details>
  );
}

interface ReturnScheduleDetailsProps {
  pickupAt: Date | null;
  returnAt: Date | null;
  rentalDays: number;
  fulfillmentMethod: FulfillmentMethod | null;
}

/** Collapsible return deadline, with the existing 22-hour return rule spelled out against the real schedule. */
export function ReturnScheduleDetails({
  pickupAt,
  returnAt,
  rentalDays,
  fulfillmentMethod,
}: ReturnScheduleDetailsProps) {
  const extraDays = Math.max(0, rentalDays - 1);

  return (
    <details className={styles.summaryDetails}>
      <summary>
        <span className={styles.summaryDetailsLabel}>Return date &amp; time</span>
        <span className={styles.summaryDetailsValue}>
          {returnAt ? formatManilaDateTime(returnAt) : "Not selected yet"}
        </span>
      </summary>

      <div className={styles.summaryDetailsBody}>
        <p className={styles.summaryDetailsNote}>
          Your return deadline uses our {RENTAL_DURATION_HOURS}-hour return rule: items are due{" "}
          {RENTAL_DURATION_HOURS} hours after your selected {handoverNoun(fulfillmentMethod)} time,
          plus 24 hours for each additional rental day.
        </p>
        {pickupAt && returnAt ? (
          <dl className={styles.breakdownRows}>
            <div>
              <dt>Selected {handoverNoun(fulfillmentMethod)} time</dt>
              <dd>{formatManilaDateTime(pickupAt)}</dd>
            </div>
            <div>
              <dt>Return rule</dt>
              <dd>
                + {RENTAL_DURATION_HOURS} hours
                {extraDays > 0 ? ` + ${extraDays} × 24 hours` : ""}
              </dd>
            </div>
            <div className={styles.breakdownSubtotal}>
              <dt>Return by</dt>
              <dd>{formatManilaDateTime(returnAt)}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.summaryDetailsNote}>
            Choose your dates and time to see your exact return date and time.
          </p>
        )}
      </div>
    </details>
  );
}

interface HandoverTimeDetailsProps {
  fulfillmentMethod: FulfillmentMethod | null;
  pickupAt: Date | null;
  estimatedDeliveryAt: Date | null;
}

/** Collapsible pickup/delivery time; for delivery it adds the minimum transportation allowance and a chat link. */
export function HandoverTimeDetails({
  fulfillmentMethod,
  pickupAt,
  estimatedDeliveryAt,
}: HandoverTimeDetailsProps) {
  const label =
    fulfillmentMethod === "pickup"
      ? "Selected pickup time"
      : fulfillmentMethod === "delivery"
        ? "Selected delivery time"
        : "Pickup/delivery time";

  return (
    <details className={styles.summaryDetails}>
      <summary>
        <span className={styles.summaryDetailsLabel}>{label}</span>
        <span className={styles.summaryDetailsValue}>
          {pickupAt ? formatManilaPickupTime(pickupAt) : "Not selected yet"}
        </span>
      </summary>

      <div className={styles.summaryDetailsBody}>
        {!pickupAt ? (
          <p className={styles.summaryDetailsNote}>Choose your dates and time to see your schedule.</p>
        ) : fulfillmentMethod === "delivery" && estimatedDeliveryAt ? (
          <>
            <dl className={styles.breakdownRows}>
              <div>
                <dt>Selected delivery time</dt>
                <dd>{formatManilaDateTime(pickupAt)}</dd>
              </div>
              <div>
                <dt>
                  Transportation allowance
                  <small>Minimum courier travel time</small>
                </dt>
                <dd>+ {DELIVERY_TRANSPORT_ALLOWANCE_HOURS} hours</dd>
              </div>
              <div className={styles.breakdownSubtotal}>
                <dt>Estimated arrival</dt>
                <dd>Around {sameDayTimeLabel(estimatedDeliveryAt, pickupAt)} or later</dd>
              </div>
            </dl>
            <p className={styles.summaryDetailsNote}>
              This is the earliest estimate, not a guaranteed time. Traffic, distance, weather, and
              courier availability may affect it.
            </p>
            <p className={styles.summaryDetailsNote}>
              Need help or an update on your delivery?{" "}
              <Link href="/messages" target="_blank" rel="noopener" className={styles.summaryDetailsLink}>
                Website Chat
              </Link>
            </p>
          </>
        ) : fulfillmentMethod === "pickup" ? (
          <p className={styles.summaryDetailsNote}>
            Pick up on {formatManilaDateTime(pickupAt)} at Right Focus Off Campus, Manuel Hizon,
            Sta. Cruz, Manila.
          </p>
        ) : (
          <p className={styles.summaryDetailsNote}>
            Selected time: {formatManilaDateTime(pickupAt)}. Choose pickup or delivery to see your
            handover details.
          </p>
        )}
      </div>
    </details>
  );
}
