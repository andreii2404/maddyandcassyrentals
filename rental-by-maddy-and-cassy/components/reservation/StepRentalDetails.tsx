"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import type { FulfillmentMethod } from "@/src/types/booking";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import {
  getTimeAvailability,
  type TimeAvailability,
} from "@/src/services/availabilityService";
import {
  calculateNextAvailableDateTime,
  calculateReturnDateTime,
  combineManilaPickupDateTime,
  formatManilaDateTime,
  formatManilaPickupTime,
  isOutsideNormalPickupWindow,
  isValidPickupTime,
  pickupDateKey,
} from "@/src/lib/rentalTiming";
import DateRangePicker from "@/components/date-range-picker/DateRangePicker";
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
  lineItems?: Array<{ product: Product; units: UnitCounts; quantity: number }>;
}

export default function StepRentalDetails({
  product,
  units,
  draft,
  onUpdate,
  onContinue,
  onBack,
  lineItems,
}: StepRentalDetailsProps) {
  const disabledDateKeys = useMemo(() => new Set<string>(), []);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeAvailability, setTimeAvailability] = useState<TimeAvailability | null>(null);

  const pickupAt = useMemo(() => {
    if (!draft.startDate || !isValidPickupTime(draft.pickupTime)) return null;
    const value = combineManilaPickupDateTime(pickupDateKey(draft.startDate), draft.pickupTime);
    return Number.isNaN(value.getTime()) ? null : value;
  }, [draft.pickupTime, draft.startDate]);

  const selectedRentalEndDate = draft.rentalEndDate ?? draft.startDate;
  const rentalDays = draft.startDate && selectedRentalEndDate
    ? Math.max(1, differenceInCalendarDays(selectedRentalEndDate, draft.startDate) + 1)
    : 1;
  const returnAt = pickupAt ? calculateReturnDateTime(pickupAt, rentalDays) : null;
  const nextAvailableAt = pickupAt ? calculateNextAvailableDateTime(pickupAt, rentalDays) : null;
  const selectedLines = useMemo(
    () => lineItems?.length ? lineItems : [{ product, units, quantity: draft.quantity }],
    [draft.quantity, lineItems, product, units],
  );

  const checkSelectedAvailability = useCallback(async (at: Date): Promise<TimeAvailability> => {
    const results = await Promise.all(selectedLines.map(async (line) => ({
      line,
      availability: await getTimeAvailability(line.product.id, at, line.quantity, rentalDays),
    })));
    const allAvailable = results.every(({ line, availability }) => availability.availableUnits >= line.quantity);
    const nextTimes = results.flatMap(({ availability }) => availability.nextAvailableAt ? [availability.nextAvailableAt] : []);
    const outside = isOutsideNormalPickupWindow(draft.pickupTime);
    const fee = outside
      ? results.every(({ availability }) => availability.pickupConvenienceFee > 0) ? 100 : 0
      : 0;
    return {
      totalUnits: selectedLines.length > 1 ? selectedLines.length : results[0]?.availability.totalUnits ?? 0,
      availableUnits: selectedLines.length > 1 ? (allAvailable ? selectedLines.length : results.filter(({ line, availability }) => availability.availableUnits >= line.quantity).length) : results[0]?.availability.availableUnits ?? 0,
      unavailableUnits: selectedLines.length > 1 ? results.filter(({ line, availability }) => availability.availableUnits < line.quantity).length : results[0]?.availability.unavailableUnits ?? 0,
      nextAvailableAt: nextTimes.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
      pickupConvenienceFee: fee,
    };
  }, [draft.pickupTime, rentalDays, selectedLines]);

  useEffect(() => {
    if (!pickupAt || pickupAt.getTime() <= Date.now()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      checkSelectedAvailability(pickupAt)
        .then((result) => {
          if (cancelled) return;
          setTimeAvailability(result);
          const fee = result.pickupConvenienceFee;
          if (draft.pickupConvenienceFee !== fee) {
            onUpdate({ pickupConvenienceFee: fee });
          }
        })
        .catch(() => {
          if (!cancelled) setTimeAvailability(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkSelectedAvailability, draft.pickupConvenienceFee, onUpdate, pickupAt]);

  const isDelivery = draft.fulfillmentMethod === "delivery";
  const hasValidLocation =
    draft.fulfillmentMethod === "pickup" ||
    (isDelivery &&
      draft.customerLocation.trim().length > 0 &&
      draft.cityMunicipality.trim().length > 0 &&
      draft.province.trim().length > 0);
  const canContinue =
    !!draft.startDate &&
    !!pickupAt &&
    !!returnAt &&
    !!draft.fulfillmentMethod &&
    hasValidLocation &&
    draft.quantity >= 1 &&
    !!timeAvailability &&
    (selectedLines.length > 1
      ? timeAvailability.availableUnits === selectedLines.length
      : draft.quantity <= timeAvailability.availableUnits);

  function updatePickupSchedule(
    date: Date | null,
    rentalEndDate: Date | null = date,
    pickupTime = draft.pickupTime,
  ) {
    if (!date || !rentalEndDate || !isValidPickupTime(pickupTime)) {
      onUpdate({
        startDate: date,
        endDate: null,
        rentalEndDate,
        pickupTime,
        pickupConvenienceFee: 0,
      });
      setTimeAvailability(null);
      return;
    }
    const nextPickupAt = combineManilaPickupDateTime(pickupDateKey(date), pickupTime);
    const nextRentalDays = Math.max(1, differenceInCalendarDays(rentalEndDate, date) + 1);
    onUpdate({
      startDate: nextPickupAt,
      endDate: calculateReturnDateTime(nextPickupAt, nextRentalDays),
      rentalEndDate,
      pickupTime,
      pickupConvenienceFee: 0,
    });
    setTimeAvailability(null);
  }

  function handleFulfillmentChange(method: FulfillmentMethod) {
    if (method === "pickup") {
      // Pickup never carries a delivery address -- clear any address the
      // customer may have typed while "delivery" was selected so a
      // subsequent switch back to delivery doesn't reuse stale values.
      onUpdate({
        fulfillmentMethod: method,
        customerLocation: "",
        cityMunicipality: "",
        province: "",
        pickupConvenienceFee: timeAvailability?.pickupConvenienceFee ?? 0,
      });
    } else {
      onUpdate({ fulfillmentMethod: method, pickupConvenienceFee: timeAvailability?.pickupConvenienceFee ?? 0 });
    }
  }

  async function handleContinue() {
    setError(null);

    if (!pickupAt || !returnAt) {
      setError("Please select a pickup date and pickup time.");
      return;
    }
    if (pickupAt.getTime() <= Date.now()) {
      setError("Please select a future pickup date and time.");
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
    let latestAvailability: TimeAvailability;
    try {
      latestAvailability = await checkSelectedAvailability(pickupAt);
    } catch {
      setChecking(false);
      setError("The exact pickup-time availability could not be checked. Please try again.");
      return;
    }
    setChecking(false);
    setTimeAvailability(latestAvailability);
    const fee = latestAvailability.pickupConvenienceFee;
    if (draft.pickupConvenienceFee !== fee) {
      onUpdate({ pickupConvenienceFee: fee });
    }

    if (selectedLines.length > 1 ? latestAvailability.availableUnits < selectedLines.length : latestAvailability.availableUnits < draft.quantity) {
      const requestedTime = formatManilaPickupTime(pickupAt);
      const availableMessage = latestAvailability.nextAvailableAt
        ? ` and will be available starting ${formatManilaDateTime(latestAvailability.nextAvailableAt)}`
        : " at a later time";
      setError(
        `${requestedTime} pickup is unavailable. This unit is still assigned to a previous rental${availableMessage}.`,
      );
      return;
    }

    onContinue();
  }

  return (
    <div className={styles.wrapper}>
      <div>
        <h2 className={styles.flowHeading}>Reservation</h2>
        <p className={styles.flowSubheading}>
          Select one date, or select a start and end date for a multi-day rental. Each rental day
          follows the 22-hour use period, with a two-hour preparation period after the final return.
        </p>
      </div>
      <div className={styles.grid}>
        <div>
          <h3 className={styles.sectionHeading}>Pickup Date &amp; Time</h3>
          <div className={styles.scheduleGrid}>
            <DateRangePicker
              startDate={draft.startDate}
              endDate={selectedRentalEndDate}
              onChange={({ startDate, endDate }) => updatePickupSchedule(startDate, endDate)}
              disabledDateKeys={disabledDateKeys}
            />
            <div className={styles.scheduleDetails}>
              <div className={styles.pickupTimeField}>
                <label htmlFor="pickupTime">Pickup time</label>
                <input
                  id="pickupTime"
                  type="time"
                  step={900}
                  value={draft.pickupTime}
                  onChange={(event) => updatePickupSchedule(
                    draft.startDate,
                    selectedRentalEndDate,
                    event.target.value,
                  )}
                />
                <span>Normal window: 9:00 AM–7:00 PM</span>
              </div>

              <p className={styles.availabilityStatus} role="status">
                {pickupAt && !timeAvailability
                  ? "Checking this exact pickup time..."
                  : timeAvailability
                    ? selectedLines.length > 1
                      ? `${timeAvailability.availableUnits} of ${timeAvailability.totalUnits} selected products available for this exact schedule.`
                      : `${timeAvailability.availableUnits} of ${timeAvailability.totalUnits} unit${timeAvailability.totalUnits === 1 ? "" : "s"} available.`
                    : "Select a date and time to check this unit."}
              </p>

              {pickupAt && returnAt && nextAvailableAt ? (
                <dl className={styles.timingSummary}>
                  <div><dt>Pickup</dt><dd>{formatManilaDateTime(pickupAt)}</dd></div>
                  <div><dt>Return ({rentalDays} {rentalDays === 1 ? "day" : "days"})</dt><dd>{formatManilaDateTime(returnAt)}</dd></div>
                  <div><dt>Ready again</dt><dd>{formatManilaDateTime(nextAvailableAt)}</dd></div>
                </dl>
              ) : null}

              {pickupAt && isOutsideNormalPickupWindow(draft.pickupTime) && timeAvailability ? (
                <p className={styles.convenienceNotice}>
                  {timeAvailability.pickupConvenienceFee > 0
                    ? `A ₱100 convenience fee applies because you voluntarily chose ${draft.fulfillmentMethod === "delivery" ? "delivery" : "pickup"} before 9:00 AM or after 7:00 PM.`
                    : "No convenience fee applies because item availability requires this later time."}
                </p>
              ) : null}

              {selectedLines.length > 1 ? (
                <div className={styles.multiItemPanel}>
                  <div><strong>Items in this reservation</strong><span>Quantities come from your cart.</span></div>
                  <ul>{selectedLines.map((line) => <li key={line.product.id}><span>{line.product.name}</span><strong>× {line.quantity}</strong></li>)}</ul>
                </div>
              ) : <div className={styles.quantityPanel}>
                <div>
                  <label htmlFor="rentalQuantity">Quantity</label>
                  <span>{units.totalUnits} {units.totalUnits === 1 ? "unit" : "units"} in inventory</span>
                </div>
                <div className={styles.quantityControl}>
                  <button type="button" onClick={() => onUpdate({ quantity: draft.quantity - 1 })} disabled={draft.quantity <= 1} aria-label="Decrease rental quantity">−</button>
                  <input
                    id="rentalQuantity"
                    type="number"
                    min={1}
                    max={Math.max(1, timeAvailability?.availableUnits ?? units.totalUnits)}
                    value={draft.quantity}
                    onChange={(event) => onUpdate({ quantity: Math.max(1, Math.min(Math.max(1, units.totalUnits), Number(event.target.value) || 1)) })}
                  />
                  <button type="button" onClick={() => onUpdate({ quantity: draft.quantity + 1 })} disabled={draft.quantity >= units.totalUnits} aria-label="Increase rental quantity">+</button>
                </div>
              </div>}
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
