"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format, isSameDay } from "date-fns";
import type { Product } from "@/types/product";
import type { FulfillmentMethod } from "@/src/types/booking";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import type { MultiItemReservationPricing } from "@/src/lib/reservationPricing";
import {
  checkBatchTimeAvailability,
  getCalendarDateStatuses,
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

interface StepCartRentalDetailsProps {
  lines: { product: Product; quantity: number }[];
  draft: ReservationDraft;
  pricing: MultiItemReservationPricing;
  onUpdate: (patch: Partial<ReservationDraft>) => void;
  onContinue: () => void;
  onBack?: () => void;
}

export default function StepCartRentalDetails({
  lines,
  draft,
  pricing,
  onUpdate,
  onContinue,
  onBack,
}: StepCartRentalDetailsProps) {
  const [disabledDateKeys, setDisabledDateKeys] = useState<Set<string>>(new Set());
  const [confirmedDateKeys, setConfirmedDateKeys] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityByProductId, setAvailabilityByProductId] = useState<Map<string, TimeAvailability>>(
    new Map(),
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  // A plain string, not the `lines` array, so this doesn't refire the
  // effect below just because the parent re-created the lines array with the
  // same product ids on an unrelated render.
  const lineProductIdsKey = lines.map((line) => line.product.id).join(",");

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // A day is disabled for the shared cart calendar if any line's product is
  // fully booked that day -- every line shares the one pickup date/time, so
  // any single unavailable line should block the date for all of them. Same
  // server-backed data source as the pickup-time/quantity/checkout checks.
  // A disabled day only renders grey (confirmed) if every line that blocks it
  // does so with bookings already approved/confirmed/released by admin; if
  // even one blocking line is still pending review, the day stays red, since
  // rejecting that one booking would still change the picture.
  useEffect(() => {
    let cancelled = false;
    const productIds = lineProductIdsKey ? lineProductIdsKey.split(",") : [];
    Promise.all(
      productIds.map((productId) =>
        getCalendarDateStatuses(productId).catch(() => ({
          disabledDateKeys: new Set<string>(),
          confirmedDateKeys: new Set<string>(),
        })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const union = new Set<string>();
      for (const { disabledDateKeys } of results) {
        for (const key of disabledDateKeys) union.add(key);
      }
      const confirmedUnion = new Set<string>();
      for (const key of union) {
        const allConfirmed = results.every(
          ({ disabledDateKeys, confirmedDateKeys }) =>
            !disabledDateKeys.has(key) || confirmedDateKeys.has(key),
        );
        if (allConfirmed) confirmedUnion.add(key);
      }
      setDisabledDateKeys(union);
      setConfirmedDateKeys(confirmedUnion);
    });
    return () => {
      cancelled = true;
    };
  }, [lineProductIdsKey]);

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
      checkBatchTimeAvailability(
        lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        pickupAt,
        rentalDays,
      )
        .then((result) => {
          if (cancelled) return;
          setAvailabilityByProductId(result);
          const fee = isOutsideNormalPickupWindow(draft.pickupTime)
            ? PICKUP_CONVENIENCE_FEE
            : 0;
          if (draft.pickupConvenienceFee !== fee) {
            onUpdate({ pickupConvenienceFee: fee });
          }
        })
        .catch(() => {
          if (!cancelled) setAvailabilityByProductId(new Map());
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.fulfillmentMethod, pickupAt, rentalDays]);

  const isDelivery = draft.fulfillmentMethod === "delivery";
  const hasValidLocation =
    draft.fulfillmentMethod === "pickup" ||
    (isDelivery &&
      draft.customerLocation.trim().length > 0 &&
      draft.cityMunicipality.trim().length > 0 &&
      draft.province.trim().length > 0);

  const unavailableLines = lines.filter((line) => {
    const availability = availabilityByProductId.get(line.product.id);
    return availability !== undefined && availability.availableUnits < line.quantity;
  });

  const allChecked = pickupAt && lines.every((line) => availabilityByProductId.has(line.product.id));

  const canContinue =
    !!draft.startDate &&
    !!pickupAt &&
    !isPickupTimePast &&
    !!returnAt &&
    !!draft.fulfillmentMethod &&
    hasValidLocation &&
    allChecked &&
    unavailableLines.length === 0;

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
    if (!allChecked) {
      missingItems.push("Checking availability for this time…");
    } else {
      for (const line of unavailableLines) {
        const availability = availabilityByProductId.get(line.product.id);
        const availableFrom = availability?.nextAvailableAt
          ? ` It will be available starting ${formatManilaDateTime(availability.nextAvailableAt)}.`
          : "";
        missingItems.push(
          `${line.product.name} is unavailable for these dates — only ${availability?.availableUnits ?? 0} of ${line.quantity} requested unit(s) available.${availableFrom}`,
        );
      }
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
      setAvailabilityByProductId(new Map());
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
    setAvailabilityByProductId(new Map());
  }

  function handleFulfillmentChange(method: FulfillmentMethod) {
    const scheduleFee = isOutsideNormalPickupWindow(draft.pickupTime)
      ? PICKUP_CONVENIENCE_FEE
      : 0;
    if (method === "pickup") {
      onUpdate({
        fulfillmentMethod: method,
        customerLocation: "",
        cityMunicipality: "",
        province: "",
        pickupConvenienceFee: scheduleFee,
      });
    } else {
      onUpdate({ fulfillmentMethod: method, pickupConvenienceFee: scheduleFee });
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
    let latest: Map<string, TimeAvailability>;
    try {
      latest = await checkBatchTimeAvailability(
        lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        pickupAt,
        rentalDays,
      );
    } catch {
      setChecking(false);
      setError("Availability could not be checked. Please try again.");
      return;
    }
    setChecking(false);
    setAvailabilityByProductId(latest);

    const stillUnavailable = lines.filter((line) => (latest.get(line.product.id)?.availableUnits ?? 0) < line.quantity);
    if (stillUnavailable.length > 0) {
      setError(
        `${stillUnavailable.map((line) => line.product.name).join(", ")} ${stillUnavailable.length === 1 ? "is" : "are"} unavailable for these dates.`,
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
          Pick one shared pickup date, time, and fulfillment method for every item in your cart.
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
              idPrefix="cart-pickup-time"
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
              data-state={!pickupAt || isPickupTimePast ? "waiting" : allChecked ? "ready" : "checking"}
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
                      : allChecked
                        ? "Date and time saved"
                        : "Time saved—checking all items"}
                </strong>
                <small>
                  {pickupAt && !isPickupTimePast
                    ? `${selectedDatesLabel} · ${formatManilaPickupTime(pickupAt)}${allChecked ? ` · ${unavailableLines.length === 0 ? "all items available" : `${unavailableLines.length} unavailable`}` : ""}`
                    : "Your exact pickup or delivery schedule will appear here before you continue."}
                </small>
              </span>
            </div>

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
                How would you like to get your rentals?<span className={formStyles.required}>*</span>
              </legend>

              <label className={styles.fulfillmentOption}>
                <input
                  type="radio"
                  name="cartFulfillmentMethod"
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
                  name="cartFulfillmentMethod"
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
                  <label className={formStyles.label} htmlFor="cartCustomerLocation">
                    Delivery address<span className={formStyles.required}>*</span>
                  </label>
                  <textarea
                    id="cartCustomerLocation"
                    autoComplete="address-line1"
                    className={formStyles.textarea}
                    value={draft.customerLocation}
                    onChange={(event) => onUpdate({ customerLocation: event.target.value })}
                    placeholder="House/unit number, street, barangay, and any landmark details"
                  />
                </div>

                <div className={formStyles.row}>
                  <div className={formStyles.field}>
                    <label className={formStyles.label} htmlFor="cartCityMunicipality">
                      City/Municipality<span className={formStyles.required}>*</span>
                    </label>
                    <input
                      id="cartCityMunicipality"
                      type="text"
                      autoComplete="address-level2"
                      className={formStyles.input}
                      value={draft.cityMunicipality}
                      onChange={(event) => onUpdate({ cityMunicipality: event.target.value })}
                      placeholder="e.g. Manila"
                    />
                  </div>

                  <div className={formStyles.field}>
                    <label className={formStyles.label} htmlFor="cartProvince">
                      Province<span className={formStyles.required}>*</span>
                    </label>
                    <select
                      id="cartProvince"
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
        </div>

        <aside className={styles.summaryColumn} aria-label="Booking summary">
          <div className={styles.summaryCard}>
            <p className={styles.summaryEyebrow}>4. Review &amp; Booking Summary</p>
            <h3 className={styles.summaryProduct}>
              {pricing.productCount} {pricing.productCount === 1 ? "product" : "products"} · {pricing.totalUnits} {pricing.totalUnits === 1 ? "unit" : "units"}
            </h3>

            <ul className={styles.summaryItemList}>
              {lines.map((line) => {
                const availability = availabilityByProductId.get(line.product.id);
                const unavailable = availability !== undefined && availability.availableUnits < line.quantity;
                return (
                  <li key={line.product.id} className={unavailable ? styles.summaryItemUnavailable : undefined}>
                    <span>{line.product.name}</span>
                    <span>{line.quantity} {line.quantity === 1 ? "unit" : "units"}</span>
                  </li>
                );
              })}
            </ul>

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
                {pricing.rentalDays > 0 ? `${pricing.finalAmount.toLocaleString()}` : "Choose dates"}
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
              <button type="button" className={formStyles.primaryButton} disabled={!canContinue || checking} onClick={() => void handleContinue()}>
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
          onClick={() => void handleContinue()}
        >
          {checking ? "Checking availability..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
