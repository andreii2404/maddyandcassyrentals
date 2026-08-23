"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, isSameDay } from "date-fns";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import type { FulfillmentMethod } from "@/src/types/booking";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import type { ReservationPricing } from "@/src/lib/reservationPricing";
import {
  getCalendarDateStatuses,
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
  PICKUP_CONVENIENCE_FEE,
  pickupDateKey,
} from "@/src/lib/rentalTiming";
import DateRangePicker from "@/components/date-range-picker/DateRangePicker";
import PickupTimeSelector from "@/components/reservation/PickupTimeSelector";
import formStyles from "@/components/ui/Form.module.css";
import styles from "./StepRentalDetails.module.css";
import { PHILIPPINE_PROVINCES } from "@/src/data/philippineLocations";

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
  const [disabledDateKeys, setDisabledDateKeys] = useState<Set<string>>(new Set());
  const [confirmedDateKeys, setConfirmedDateKeys] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeAvailability, setTimeAvailability] = useState<TimeAvailability | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Mark calendar days that are fully booked for every active unit, from the
  // same server-backed reserved_window data the pickup-time/quantity/checkout
  // checks below use -- so the calendar can't show a date as pickable that
  // the exact-time check would then reject. Days where every blocking
  // booking is already admin-approved/confirmed/released render grey
  // (confirmedDateKeys); days still blocked only by pending-review bookings
  // render red. This is still a UX-only, day-granularity hint: the
  // authoritative check is getTimeAvailability below, and the real guard is
  // the create_*_booking RPC at submission.
  useEffect(() => {
    let cancelled = false;
    getCalendarDateStatuses(product.id)
      .then(({ disabledDateKeys, confirmedDateKeys }) => {
        if (cancelled) return;
        setDisabledDateKeys(disabledDateKeys);
        setConfirmedDateKeys(confirmedDateKeys);
      })
      .catch(() => {
        if (cancelled) return;
        setDisabledDateKeys(new Set());
        setConfirmedDateKeys(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [product.id]);

  const pickupAt = useMemo(() => {
    if (!draft.startDate || !isValidPickupTime(draft.pickupTime)) return null;
    const value = combineManilaPickupDateTime(pickupDateKey(draft.startDate), draft.pickupTime);
    return Number.isNaN(value.getTime()) ? null : value;
  }, [draft.pickupTime, draft.startDate]);

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
          const fee = isOutsideNormalPickupWindow(draft.pickupTime)
            ? PICKUP_CONVENIENCE_FEE
            : 0;
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
  }, [draft.fulfillmentMethod, draft.pickupConvenienceFee, draft.pickupTime, draft.quantity, onUpdate, pickupAt, product.id, rentalDays]);

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
    missingItems.push("Choose a pickup or delivery time.");
  } else if (isPickupTimePast) {
    missingItems.push("Choose a pickup or delivery time that hasn't passed yet.");
  }
  if (!draft.fulfillmentMethod) {
    missingItems.push("Choose pickup or delivery.");
  } else if (isDelivery && !hasValidLocation) {
    missingItems.push("Add your complete delivery address.");
  }
  if (pickupAt && !isPickupTimePast && draft.fulfillmentMethod && hasValidLocation) {
    if (!timeAvailability) {
      missingItems.push("Checking availability for this time…");
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
    // Keep an earlier time visible so the form can explain what needs fixing
    // instead of appearing to lose the customer's selection.
    if (!date || !rentalEndDate || !isValidPickupTime(pickupTime)) {
      onUpdate({
        startDate: date,
        endDate: null,
        rentalEndDate,
        pickupTime,
        pickupConvenienceFee: isOutsideNormalPickupWindow(pickupTime)
          ? PICKUP_CONVENIENCE_FEE
          : 0,
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
      pickupConvenienceFee: isOutsideNormalPickupWindow(pickupTime)
        ? PICKUP_CONVENIENCE_FEE
        : 0,
    });
    setTimeAvailability(null);
  }

  function handleFulfillmentChange(method: FulfillmentMethod) {
    const scheduleFee = isOutsideNormalPickupWindow(draft.pickupTime)
      ? PICKUP_CONVENIENCE_FEE
      : 0;
    if (method === "pickup") {
      // Pickup never carries a delivery address -- clear any address the
      // customer may have typed while "delivery" was selected so a
      // subsequent switch back to delivery doesn't reuse stale values.
      onUpdate({
        fulfillmentMethod: method,
        customerLocation: "",
        cityMunicipality: "",
        province: "",
        pickupConvenienceFee: scheduleFee,
      });
    } else {
      onUpdate({
        fulfillmentMethod: method,
        pickupConvenienceFee: scheduleFee,
      });
    }
  }

  async function handleContinue() {
    setError(null);

    if (!pickupAt || !returnAt) {
      setError("Please select a rental date and pickup or delivery time.");
      return;
    }
    if (pickupAt.getTime() <= Date.now()) {
      setError("Please select a future pickup or delivery time.");
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
    const fee = isOutsideNormalPickupWindow(draft.pickupTime)
      ? PICKUP_CONVENIENCE_FEE
      : 0;
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
          Pick your dates, choose a time, and let us know how you&apos;d like to get your rental.
        </p>
      </div>

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={`${styles.stepSection} ${styles.dateSection}`}>
            <h3 className={styles.sectionHeading}>1. Choose your dates</h3>
            <p className={styles.sectionHint}>
              Select one date, or select a start and end date for a multi-day rental.
            </p>
            <DateRangePicker
              startDate={draft.startDate}
              endDate={selectedRentalEndDate}
              onChange={({ startDate, endDate }) => updatePickupSchedule(startDate, endDate)}
              disabledDateKeys={disabledDateKeys}
              confirmedDateKeys={confirmedDateKeys}
              compact
            />
          </section>

          <section className={`${styles.stepSection} ${styles.timeSection}`}>
            <h3 className={styles.sectionHeading}>2. Choose pickup or delivery time</h3>
            <PickupTimeSelector
              idPrefix="pickup-time"
              value={draft.pickupTime}
              invalid={isPickupTimePast}
              onChange={(value) => updatePickupSchedule(
                draft.startDate,
                selectedRentalEndDate,
                value,
              )}
            />

            {isPickupTimePast ? (
              <p className={formStyles.errorText} role="alert">
                This time has already passed for the selected date. Your choice is saved—pick a
                future time or choose a later date.
              </p>
            ) : null}

            <div
              className={styles.scheduleConfirmation}
              data-state={!pickupAt || isPickupTimePast ? "waiting" : timeAvailability ? "ready" : "checking"}
              role="status"
            >
              <span className={styles.scheduleConfirmationIcon} aria-hidden="true">
                {pickupAt && !isPickupTimePast ? "✓" : "i"}
              </span>
              <span>
                <strong>
                  {!pickupAt
                    ? "Select both a date and time"
                    : isPickupTimePast
                      ? "Choose a future schedule"
                      : timeAvailability
                        ? "Date and time saved"
                        : "Time saved—checking availability"}
                </strong>
                <small>
                  {pickupAt && !isPickupTimePast
                    ? `${selectedDatesLabel} · ${formatManilaPickupTime(pickupAt)}${timeAvailability ? ` · ${timeAvailability.availableUnits} of ${timeAvailability.totalUnits} available` : ""}`
                    : "Your exact pickup or delivery schedule will appear here before you continue."}
                </small>
              </span>
            </div>

            {timeAvailability && draft.quantity > timeAvailability.availableUnits ? (
              <p className={formStyles.errorText} role="status">
                {timeAvailability.nextAvailableAt
                  ? `This unit is still assigned to a previous rental and will be available starting ${formatManilaDateTime(timeAvailability.nextAvailableAt)}.`
                  : "This unit is still assigned to a previous rental at this time. Try a different date or pickup time."}
              </p>
            ) : null}

            {draft.fulfillmentMethod && pickupAt && isOutsideNormalPickupWindow(draft.pickupTime) ? (
              <p className={styles.convenienceNotice}>
                A ₱100 convenience fee applies because you chose {draft.fulfillmentMethod === "delivery" ? "delivery" : "pickup"} before 9:00 AM or after 7:00 PM.
              </p>
            ) : null}
          </section>

          <section className={`${styles.stepSection} ${styles.fulfillmentSection}`}>
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

          <section className={`${styles.stepSection} ${styles.quantitySection}`}>
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
                <dt>Pickup/delivery time</dt>
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
            <div className={styles.summaryActions}>
              {onBack ? <button type="button" className={formStyles.secondaryButton} onClick={onBack} disabled={checking}>Back</button> : <span />}
              <button type="button" className={formStyles.primaryButton} disabled={!canContinue || checking} onClick={handleContinue}>
                {checking ? "Checking…" : "Continue"}
              </button>
            </div>
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
