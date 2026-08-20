"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, isSameDay } from "date-fns";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import type { FulfillmentMethod } from "@/src/types/booking";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import type { ReservationPricing } from "@/src/lib/reservationPricing";
import {
  getTimeAvailability,
  type TimeAvailability,
} from "@/src/services/availabilityService";
import {
  calculateReturnDateTime,
  combineManilaPickupDateTime,
  formatManilaDateTime,
  formatManilaPickupTime,
  isOutsideNormalPickupWindow,
  isValidPickupTime,
  manilaTimeInputValue,
  pickupDateKey,
} from "@/src/lib/rentalTiming";
import DateRangePicker from "@/components/date-range-picker/DateRangePicker";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./StepRentalDetails.module.css";
import { PHILIPPINE_PROVINCES } from "@/src/data/philippineLocations";

function isPickupTimeInPast(date: Date | null, time: string): boolean {
  if (!date || !isValidPickupTime(time)) return false;
  const candidate = combineManilaPickupDateTime(pickupDateKey(date), time);
  return !Number.isNaN(candidate.getTime()) && candidate.getTime() <= Date.now();
}

interface StepRentalDetailsProps {
  product: Product;
  units: UnitCounts;
  draft: ReservationDraft;
  pricing: ReservationPricing;
  onUpdate: (patch: Partial<ReservationDraft>) => void;
  onContinue: () => void;
  onBack?: () => void;
}

export default function StepRentalDetails({
  product,
  units,
  draft,
  pricing,
  onUpdate,
  onContinue,
  onBack,
}: StepRentalDetailsProps) {
  const disabledDateKeys = useMemo(() => new Set<string>(), []);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeAvailability, setTimeAvailability] = useState<TimeAvailability | null>(null);
  const [pastTimeNotice, setPastTimeNotice] = useState(() =>
    isPickupTimeInPast(draft.startDate, draft.pickupTime),
  );
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const pickupAt = useMemo(() => {
    if (!draft.startDate || !isValidPickupTime(draft.pickupTime)) return null;
    const value = combineManilaPickupDateTime(pickupDateKey(draft.startDate), draft.pickupTime);
    return Number.isNaN(value.getTime()) ? null : value;
  }, [draft.pickupTime, draft.startDate]);

  const isPickupToday = !!draft.startDate && pickupDateKey(draft.startDate) === pickupDateKey(new Date(nowTick));
  const earliestPickupTimeToday = manilaTimeInputValue(new Date(nowTick));
  const isPickupTimePast = !!pickupAt && pickupAt.getTime() <= nowTick;

  const selectedRentalEndDate = draft.rentalEndDate ?? draft.startDate;
  const rentalDays = draft.startDate && selectedRentalEndDate
    ? Math.max(1, differenceInCalendarDays(selectedRentalEndDate, draft.startDate) + 1)
    : 1;
  const returnAt = pickupAt ? calculateReturnDateTime(pickupAt, rentalDays) : null;

  useEffect(() => {
    if (!pickupAt || pickupAt.getTime() <= Date.now()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getTimeAvailability(product.id, pickupAt, draft.quantity, rentalDays)
        .then((result) => {
          if (cancelled) return;
          setTimeAvailability(result);
          const fee = draft.fulfillmentMethod === "pickup" ? result.pickupConvenienceFee : 0;
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
  }, [draft.fulfillmentMethod, draft.pickupConvenienceFee, draft.quantity, onUpdate, pickupAt, product.id, rentalDays]);

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
    !isPickupTimePast &&
    !!returnAt &&
    !!draft.fulfillmentMethod &&
    hasValidLocation &&
    draft.quantity >= 1 &&
    !!timeAvailability &&
    draft.quantity <= timeAvailability.availableUnits;

  const missingItems: string[] = [];
  if (!draft.startDate) {
    missingItems.push("Choose your rental dates.");
  }
  if (draft.startDate && !isValidPickupTime(draft.pickupTime)) {
    missingItems.push("Choose a pickup time.");
  } else if (isPickupTimePast) {
    missingItems.push("Pick a pickup time that hasn't passed yet.");
  }
  if (!draft.fulfillmentMethod) {
    missingItems.push("Choose pickup or delivery.");
  } else if (isDelivery && !hasValidLocation) {
    missingItems.push("Add your complete delivery address.");
  }
  if (pickupAt && !isPickupTimePast && draft.fulfillmentMethod && hasValidLocation) {
    if (!timeAvailability) {
      missingItems.push("Checking availability for this pickup time…");
    } else if (draft.quantity > timeAvailability.availableUnits) {
      missingItems.push(`Only ${timeAvailability.availableUnits} unit${timeAvailability.availableUnits === 1 ? "" : "s"} available at this time — lower the quantity.`);
    }
  }

  const selectedDatesLabel =
    draft.startDate && selectedRentalEndDate
      ? isSameDay(draft.startDate, selectedRentalEndDate)
        ? format(draft.startDate, "EEE, MMM d, yyyy")
        : `${format(draft.startDate, "MMM d, yyyy")} – ${format(selectedRentalEndDate, "MMM d, yyyy")}`
      : "Not selected yet";

  function updatePickupSchedule(
    date: Date | null,
    rentalEndDate: Date | null = date,
    pickupTime = draft.pickupTime,
  ) {
    // A time that's already past for today's date is never accepted -- drop
    // it back to unset rather than let a stale selection sit in the field.
    const rejectPastTime = isValidPickupTime(pickupTime) && isPickupTimeInPast(date, pickupTime);
    const effectiveTime = rejectPastTime ? "" : pickupTime;
    setPastTimeNotice(rejectPastTime);

    if (!date || !rentalEndDate || !isValidPickupTime(effectiveTime)) {
      onUpdate({
        startDate: date,
        endDate: null,
        rentalEndDate,
        pickupTime: effectiveTime,
        pickupConvenienceFee: 0,
      });
      setTimeAvailability(null);
      return;
    }
    const nextPickupAt = combineManilaPickupDateTime(pickupDateKey(date), effectiveTime);
    const nextRentalDays = Math.max(1, differenceInCalendarDays(rentalEndDate, date) + 1);
    onUpdate({
      startDate: nextPickupAt,
      endDate: calculateReturnDateTime(nextPickupAt, nextRentalDays),
      rentalEndDate,
      pickupTime: effectiveTime,
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
      onUpdate({ fulfillmentMethod: method, pickupConvenienceFee: 0 });
    }
  }

  async function handleContinue() {
    setError(null);

    if (!pickupAt || !returnAt) {
      setError("Please select a pickup date and pickup time.");
      return;
    }
    if (pickupAt.getTime() <= Date.now()) {
      setError("Please select a future pickup time.");
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
      latestAvailability = await getTimeAvailability(product.id, pickupAt, draft.quantity, rentalDays);
    } catch {
      setChecking(false);
      setError("The exact pickup-time availability could not be checked. Please try again.");
      return;
    }
    setChecking(false);
    setTimeAvailability(latestAvailability);
    const fee = draft.fulfillmentMethod === "pickup" ? latestAvailability.pickupConvenienceFee : 0;
    if (draft.pickupConvenienceFee !== fee) {
      onUpdate({ pickupConvenienceFee: fee });
    }

    if (latestAvailability.availableUnits < draft.quantity) {
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
          Pick your dates, choose a pickup time, and let us know how you&apos;d like to get your rental.
        </p>
      </div>

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={styles.stepSection}>
            <h3 className={styles.sectionHeading}>1. Choose your dates</h3>
            <p className={styles.sectionHint}>
              Select one date, or select a start and end date for a multi-day rental.
            </p>
            <DateRangePicker
              startDate={draft.startDate}
              endDate={selectedRentalEndDate}
              onChange={({ startDate, endDate }) => updatePickupSchedule(startDate, endDate)}
              disabledDateKeys={disabledDateKeys}
              hideSelectionSummary
            />
          </section>

          <section className={styles.stepSection}>
            <h3 className={styles.sectionHeading}>2. Choose a pickup time</h3>
            <div className={styles.pickupTimeField}>
              <label htmlFor="pickupTime">Pickup time</label>
              <input
                id="pickupTime"
                type="time"
                step={900}
                min={isPickupToday ? earliestPickupTimeToday : undefined}
                value={draft.pickupTime}
                onChange={(event) => updatePickupSchedule(
                  draft.startDate,
                  selectedRentalEndDate,
                  event.target.value,
                )}
              />
              <span>Normal window: 9:00 AM–7:00 PM</span>
              {pastTimeNotice || isPickupTimePast ? (
                <p className={formStyles.errorText} role="alert">
                  Please select a future pickup time.
                </p>
              ) : null}
            </div>

            <p className={styles.availabilityStatus} role="status">
              {pickupAt && !timeAvailability
                ? "Checking this exact pickup time..."
                : timeAvailability
                  ? `${timeAvailability.availableUnits} of ${timeAvailability.totalUnits} unit${timeAvailability.totalUnits === 1 ? "" : "s"} available.`
                  : "Select a date and time to check this unit."}
            </p>

            {draft.fulfillmentMethod === "pickup" && pickupAt && isOutsideNormalPickupWindow(draft.pickupTime) && timeAvailability ? (
              <p className={styles.convenienceNotice}>
                {timeAvailability.pickupConvenienceFee > 0
                  ? "A ₱100 convenience fee applies because you chose a pickup outside 9:00 AM–7:00 PM."
                  : "No convenience fee applies because availability requires this later pickup time."}
              </p>
            ) : null}
          </section>

          <section className={styles.stepSection}>
            <h3 className={styles.sectionHeading}>3. Pickup or delivery</h3>

            <fieldset className={styles.fulfillmentFieldset}>
              <legend className={formStyles.label}>
                How would you like to get your rental?<span className={formStyles.required}>*</span>
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
          </section>

          <section className={styles.stepSection}>
            <h3 className={styles.sectionHeading}>4. Quantity</h3>
            <div className={styles.quantityPanel}>
              <div>
                <label htmlFor="rentalQuantity">How many do you need?</label>
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
            </div>
          </section>
        </div>

        <aside className={styles.summaryColumn} aria-label="Booking summary">
          <div className={styles.summaryCard}>
            <p className={styles.summaryEyebrow}>5. Review &amp; Booking Summary</p>
            <h3 className={styles.summaryProduct}>{product.name}</h3>

            <dl className={styles.summaryList}>
              <div>
                <dt>Selected dates</dt>
                <dd>{selectedDatesLabel}</dd>
              </div>
              <div>
                <dt>Pickup time</dt>
                <dd>{pickupAt ? formatManilaPickupTime(pickupAt) : "Not selected yet"}</dd>
              </div>
              <div>
                <dt>Return time</dt>
                <dd>{returnAt ? formatManilaDateTime(returnAt) : "Not selected yet"}</dd>
              </div>
              <div>
                <dt>Quantity</dt>
                <dd>{draft.quantity} {draft.quantity === 1 ? "unit" : "units"}</dd>
              </div>
              <div>
                <dt>Pickup/Delivery</dt>
                <dd>
                  {draft.fulfillmentMethod === "pickup"
                    ? "Pickup"
                    : draft.fulfillmentMethod === "delivery"
                      ? "Delivery"
                      : "Not selected yet"}
                </dd>
              </div>
            </dl>

            <div className={styles.summaryTotal}>
              <span>Current total</span>
              <strong>
                {pricing.rentalDays > 0 ? `${product.currency}${pricing.finalAmount.toLocaleString()}` : "Choose dates"}
              </strong>
            </div>

            {!canContinue && missingItems.length > 0 ? (
              <div className={styles.missingNotice} role="status">
                <strong>Still needed:</strong>
                <ul>
                  {missingItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </aside>
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
