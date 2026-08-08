"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import type { FulfillmentMethod } from "@/src/types/booking";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import { getDayCount } from "@/src/types/reservationDraft";
import {
  getFullyBookedDateKeys,
  isRangeAvailable,
  MAX_RENTAL_DAYS,
} from "@/src/services/availabilityService";
import DateRangePicker from "@/components/date-range-picker/DateRangePicker";
import AvailabilityBadge from "@/components/availability-badge/AvailabilityBadge";
import Spinner from "@/components/ui/Spinner";
import { useProductAvailability } from "@/hooks/useProductAvailability";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./StepRentalDetails.module.css";
import { PHILIPPINE_PROVINCES } from "@/src/data/philippineLocations";

interface StepRentalDetailsProps {
  product: Product;
  units: UnitCounts;
  draft: ReservationDraft;
  onUpdate: (patch: Partial<ReservationDraft>) => void;
  onContinue: () => void;
  onBack?: () => void;
}

export default function StepRentalDetails({
  product,
  units,
  draft,
  onUpdate,
  onContinue,
  onBack,
}: StepRentalDetailsProps) {
  const [disabledDateKeys, setDisabledDateKeys] = useState<Set<string>>(new Set());
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availability = useProductAvailability(product.id, units.totalUnits, draft.startDate, draft.endDate);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingCalendar(true);
    getFullyBookedDateKeys(product.id).then((keys) => {
      if (!cancelled) {
        setDisabledDateKeys(keys);
        setLoadingCalendar(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [product.id, units.totalUnits]);

  const dayCount = getDayCount(draft.startDate, draft.endDate);
  const isDelivery = draft.fulfillmentMethod === "delivery";
  const hasValidLocation =
    draft.fulfillmentMethod === "pickup" ||
    (isDelivery &&
      draft.customerLocation.trim().length > 0 &&
      draft.cityMunicipality.trim().length > 0 &&
      draft.province.trim().length > 0);
  const canContinue =
    !!draft.startDate &&
    !!draft.endDate &&
    !!draft.fulfillmentMethod &&
    hasValidLocation &&
    draft.quantity >= 1 &&
    draft.quantity <= availability.availableUnits;

  function handleFulfillmentChange(method: FulfillmentMethod) {
    if (method === "pickup") {
      // Pickup never carries a delivery address -- clear any address the
      // customer may have typed while "delivery" was selected so a
      // subsequent switch back to delivery doesn't reuse stale values.
      onUpdate({ fulfillmentMethod: method, customerLocation: "", cityMunicipality: "", province: "" });
    } else {
      onUpdate({ fulfillmentMethod: method });
    }
  }

  async function handleContinue() {
    setError(null);

    if (!draft.startDate || !draft.endDate) {
      setError("Please select a start and return date.");
      return;
    }
    if (draft.endDate < draft.startDate) {
      setError("Return date cannot be earlier than the start date.");
      return;
    }
    if (!draft.fulfillmentMethod) {
      setError("Please choose pickup or delivery.");
      return;
    }
    if (isDelivery && (!draft.customerLocation.trim() || !draft.cityMunicipality.trim() || !draft.province.trim())) {
      setError("Please provide your complete delivery address, including city/municipality and province.");
      return;
    }

    setChecking(true);
    const stillAvailable = await isRangeAvailable(
      product.id,
      draft.startDate,
      draft.endDate,
      draft.quantity,
    );
    setChecking(false);

    if (!stillAvailable) {
      setError(
        `Only ${availability.availableUnits} unit${availability.availableUnits === 1 ? " is" : "s are"} available for those dates. Reduce the quantity or choose different dates.`
      );
      const keys = await getFullyBookedDateKeys(product.id);
      setDisabledDateKeys(keys);
      onUpdate({ startDate: null, endDate: null });
      return;
    }

    onContinue();
  }

  return (
    <div className={styles.wrapper}>
      <div>
        <h2 className={styles.flowHeading}>Reservation</h2>
        <p className={styles.flowSubheading}>
          Select one day with a single click, or click a later available date to choose a longer
          rental. Then choose pickup or delivery and provide the location.
        </p>
      </div>
      <div className={styles.productSummary}>
        <div className={styles.productImage}>
          <Image src={product.image} alt={product.name} fill sizes="88px" />
        </div>
        <div>
          <p className={styles.productMeta}>
            {product.brand} · {product.category}
          </p>
          <h2 className={styles.productName}>{product.name}</h2>
          <p className={styles.productRate}>
            {product.currency}
            {product.pricePerDay.toLocaleString()}
            <span>/day</span>
          </p>
          <AvailabilityBadge
            totalUnits={units.totalUnits}
            availableUnits={units.availableUnits}
            variant="compact"
            mode="summary"
          />
        </div>
      </div>

      <div className={styles.grid}>
        <div>
          <h3 className={styles.sectionHeading}>Rental Dates</h3>
          {loadingCalendar ? (
            <div className={styles.calendarLoading}>
              <Spinner label="Loading availability" />
            </div>
          ) : (
            <DateRangePicker
              startDate={draft.startDate}
              endDate={draft.endDate}
              onChange={({ startDate, endDate }) => onUpdate({ startDate, endDate })}
              disabledDateKeys={disabledDateKeys}
              maxRentalDays={MAX_RENTAL_DAYS}
            />
          )}

          <p className={styles.availabilityStatus} role="status">
            {availability.isChecking ? "Checking availability for selected dates..." : availability.statusText}
          </p>

          {dayCount > 0 ? (
            <p className={styles.dayCount}>
              {dayCount} {dayCount === 1 ? "day" : "days"} selected
            </p>
          ) : null}

          <div className={styles.quantityPanel}>
            <div>
              <label htmlFor="rentalQuantity">Rental quantity</label>
              <span>Reserve multiple units of this exact product under one booking.</span>
            </div>
            <div className={styles.quantityControl}>
              <button type="button" onClick={() => onUpdate({ quantity: draft.quantity - 1 })} disabled={draft.quantity <= 1} aria-label="Decrease rental quantity">−</button>
              <input
                id="rentalQuantity"
                type="number"
                min={1}
                max={Math.max(1, availability.availableUnits)}
                value={draft.quantity}
                onChange={(event) => onUpdate({ quantity: Math.max(1, Math.min(Math.max(1, availability.availableUnits), Number(event.target.value) || 1)) })}
              />
              <button type="button" onClick={() => onUpdate({ quantity: draft.quantity + 1 })} disabled={draft.quantity >= availability.availableUnits} aria-label="Increase rental quantity">+</button>
            </div>
          </div>
        </div>

        <div className={styles.fulfillmentColumn}>
          <h3 className={styles.sectionHeading}>Location &amp; Fulfillment</h3>

          <fieldset className={styles.fulfillmentFieldset}>
            <legend className={formStyles.label}>
              Pickup or delivery<span className={formStyles.required}>*</span>
            </legend>

            <label className={styles.fulfillmentOption}>
              <input
                type="radio"
                name="fulfillmentMethod"
                checked={draft.fulfillmentMethod === "pickup"}
                onChange={() => handleFulfillmentChange("pickup" as FulfillmentMethod)}
              />
              <span>
                <strong>Pickup</strong>
                <span className={styles.fulfillmentDetail}>
                  Right Focus Off Campus, Manuel Hizon, Sta. Cruz, Manila. Available by
                  appointment from 9:00 AM to 7:00 PM.
                </span>
              </span>
            </label>

            <label className={styles.fulfillmentOption}>
              <input
                type="radio"
                name="fulfillmentMethod"
                checked={draft.fulfillmentMethod === "delivery"}
                onChange={() => handleFulfillmentChange("delivery" as FulfillmentMethod)}
              />
              <span>
                <strong>Delivery</strong>
                <span className={styles.fulfillmentDetail}>
                  Delivery is arranged manually by the business. Delivery fees and courier
                  arrangements are handled directly with you, outside this website.
                </span>
              </span>
            </label>
          </fieldset>

          {isDelivery ? (
            <>
              <div className={formStyles.field}>
                <label className={formStyles.label} htmlFor="customerLocation">
                  Delivery address<span className={formStyles.required}>*</span>
                </label>
                <textarea
                  id="customerLocation"
                  autoComplete="address-line1"
                  className={formStyles.textarea}
                  value={draft.customerLocation}
                  onChange={(event) => onUpdate({ customerLocation: event.target.value })}
                  placeholder="House/unit number, street, barangay, and any landmark details"
                />
              </div>

              <div className={formStyles.row}>
                <div className={formStyles.field}>
                  <label className={formStyles.label} htmlFor="cityMunicipality">
                    City/Municipality<span className={formStyles.required}>*</span>
                  </label>
                  <input
                    id="cityMunicipality"
                    type="text"
                    autoComplete="address-level2"
                    className={formStyles.input}
                    value={draft.cityMunicipality}
                    onChange={(event) => onUpdate({ cityMunicipality: event.target.value })}
                    placeholder="e.g. Manila"
                  />
                </div>

                <div className={formStyles.field}>
                  <label className={formStyles.label} htmlFor="province">
                    Province<span className={formStyles.required}>*</span>
                  </label>
                  <select
                    id="province"
                    autoComplete="address-level1"
                    className={formStyles.select}
                    value={draft.province}
                    onChange={(event) => onUpdate({ province: event.target.value })}
                  >
                    <option value="">Select province</option>
                    {PHILIPPINE_PROVINCES.map((province) => (
                      <option key={province} value={province}>{province}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className={formStyles.errorText} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.footer}>
        {onBack ? (
          <button
            type="button"
            className={formStyles.secondaryButton}
            onClick={onBack}
            disabled={checking}
          >
            Back
          </button>
        ) : <span />}
        <button
          type="button"
          className={formStyles.primaryButton}
          disabled={!canContinue || checking}
          onClick={handleContinue}
        >
          {checking ? "Checking availability..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
