"use client";

import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays } from "date-fns";
import type { Product } from "@/types/product";
import type { FulfillmentMethod } from "@/src/types/booking";
import type { ReservationDraft } from "@/src/types/reservationDraft";
import type { MultiItemReservationPricing } from "@/src/lib/reservationPricing";
import {
  checkBatchReservedWindows,
  checkBatchTimeAvailability,
  getCalendarDateStatuses,
  type TimeAvailability,
} from "@/src/services/availabilityService";
import {
  calculateReturnDateTime,
  combineManilaPickupDateTime,
  computeUnavailablePickupTimeReasons,
  formatManilaDateTime,
  formatManilaPickupTime,
  isOutsideNormalPickupWindow,
  isValidPickupTime,
  PICKUP_CONVENIENCE_FEE,
  pickupDateKey,
  type PickupUnavailabilityReason,
  reservedWindowLookaheadDays,
} from "@/src/lib/rentalTiming";
import { getDraftRentalSchedule } from "@/src/lib/rentalSchedule";
import DateRangePicker from "@/components/date-range-picker/DateRangePicker";
import PickupTimeSelector from "@/components/reservation/PickupTimeSelector";
import formStyles from "@/components/ui/Form.module.css";
import ReservationFooter from "@/components/reservation/ReservationFooter";
import RentalScheduleNoticeModal from "@/components/reservation/RentalScheduleNoticeModal";
import {
  HandoverTimeDetails,
  PriceBreakdown,
  ReturnScheduleDetails,
} from "@/components/reservation/CheckoutSummaryDetails";
import { formatPeso } from "@/src/lib/emailShell";
import styles from "./StepRentalDetails.module.css";
import { PHILIPPINE_PROVINCES } from "@/src/data/philippineLocations";

interface StepCartRentalDetailsProps {
  lines: { product: Product; quantity: number; color?: string }[];
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
  const [availabilityError, setAvailabilityError] = useState(false);
  const [availabilityByProductId, setAvailabilityByProductId] = useState<Map<string, TimeAvailability>>(
    new Map(),
  );
  const [unavailableTimes, setUnavailableTimes] = useState<Set<string> | undefined>(undefined);
  const [unavailableReasons, setUnavailableReasons] = useState<
    Map<string, PickupUnavailabilityReason> | undefined
  >(undefined);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [showScheduleNotice, setShowScheduleNotice] = useState(false);
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
        getCalendarDateStatuses(productId).catch((err) => {
          console.error("getCalendarDateStatuses failed", err);
          return {
            disabledDateKeys: new Set<string>(),
            confirmedDateKeys: new Set<string>(),
          };
        }),
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

  const schedule = useMemo(
    () =>
      getDraftRentalSchedule({
        startDate: draft.startDate,
        rentalEndDate: draft.rentalEndDate,
        pickupTime: draft.pickupTime,
        fulfillmentMethod: draft.fulfillmentMethod,
      }),
    [draft.startDate, draft.rentalEndDate, draft.pickupTime, draft.fulfillmentMethod],
  );
  const { pickupAt, returnAt, rentalDays, estimatedDeliveryAt } = schedule;
  const selectedRentalEndDate = schedule.rentalEndDate;

  const isPickupTimePast = !!pickupAt && pickupAt.getTime() <= nowTick;

  useEffect(() => {
    if (!pickupAt || pickupAt.getTime() <= Date.now()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAvailabilityError(false);
      checkBatchTimeAvailability(
        lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, variant: line.color })),
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
        .catch((err) => {
          if (!cancelled) {
            console.error("checkBatchTimeAvailability failed", err);
            setAvailabilityByProductId(new Map());
            setAvailabilityError(true);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.fulfillmentMethod, pickupAt, rentalDays]);

  // A shared pickup time is blocked if it's occupied/buffered for ANY line
  // -- independent of the exact pickup time, so the picker can start
  // pre-disabled and update as soon as dates/quantities/items change.
  const lineAvailabilityKey = lines
    .map((line) => `${line.product.id}:${line.quantity}:${line.color ?? ""}`)
    .join("|");

  useEffect(() => {
    if (!draft.startDate) return;
    const dayStart = combineManilaPickupDateTime(pickupDateKey(draft.startDate), "00:00");
    if (Number.isNaN(dayStart.getTime())) return;
    let cancelled = false;
    const windowEnd = new Date(
      dayStart.getTime() + reservedWindowLookaheadDays(rentalDays) * 24 * 60 * 60 * 1000,
    );
    const timer = window.setTimeout(() => {
      checkBatchReservedWindows(
        lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, variant: line.color })),
        dayStart,
        windowEnd,
      )
        .then((result) => {
          if (cancelled) return;
          const combinedReasons = new Map<string, PickupUnavailabilityReason>();
          for (const line of lines) {
            const reserved = result.get(line.product.id);
            if (!reserved) continue;
            const reasons = computeUnavailablePickupTimeReasons(
              dayStart,
              rentalDays,
              line.quantity,
              reserved.totalUnits,
              reserved.windows,
            );
            for (const [time, reason] of reasons) {
              // A real booking conflict on any line always outranks a
              // buffer-only block from another line for the same time.
              if (reason === "booked" || combinedReasons.get(time) !== "booked") {
                combinedReasons.set(time, reason);
              }
            }
          }
          setUnavailableReasons(combinedReasons);
          setUnavailableTimes(new Set(combinedReasons.keys()));
        })
        .catch((err) => {
          if (!cancelled) {
            console.error("checkBatchReservedWindows failed", err);
            setUnavailableReasons(undefined);
            setUnavailableTimes(undefined);
          }
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.startDate, rentalDays, lineAvailabilityKey]);

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
    if (availabilityError) {
      missingItems.push("Availability could not be checked. Select the time again or try again.");
    } else if (!allChecked) {
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

  const selectedDatesLabel = schedule.datesLabel;

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
      setAvailabilityError(false);
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
    setAvailabilityError(false);
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
    setAvailabilityError(false);
    let latest: Map<string, TimeAvailability>;
    try {
      latest = await checkBatchTimeAvailability(
        lines.map((line) => ({ productId: line.product.id, quantity: line.quantity, variant: line.color })),
        pickupAt,
        rentalDays,
      );
    } catch (err) {
      console.error("checkBatchTimeAvailability failed", err);
      setChecking(false);
      setAvailabilityError(true);
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

    setShowScheduleNotice(true);
  }

  function handleConfirmScheduleNotice() {
    setShowScheduleNotice(false);
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
              unavailableTimes={draft.startDate ? unavailableTimes : undefined}
              unavailableReasons={draft.startDate ? unavailableReasons : undefined}
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
              data-state={!pickupAt || isPickupTimePast ? "waiting" : allChecked ? "ready" : availabilityError ? "waiting" : "checking"}
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
                        : availabilityError
                          ? "Availability check needs another try"
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
                How would you like to get your rentals?<span className={styles.requiredMark}>*</span>
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
                  <span className={styles.fulfillmentDetail}>Sta. Cruz, Manila · 9 AM–7 PM</span>
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
                  <span className={styles.fulfillmentDetail}>Fees arranged with you directly</span>
                </span>
              </label>
            </fieldset>

            {draft.fulfillmentMethod === "pickup" ? (
              <p className={styles.fulfillmentNote}>
                Pick up at Right Focus Off Campus, Manuel Hizon, Sta. Cruz, Manila. Available by
                appointment from 9:00 AM to 7:00 PM.
              </p>
            ) : null}

            {isDelivery ? (
              <div className={styles.deliveryFields}>
                <p className={styles.fulfillmentNote}>
                  Delivery is arranged manually by the business. Fees and courier arrangements are
                  handled directly with you, outside this website.
                </p>

                <div className={formStyles.field}>
                  <label className={formStyles.label} htmlFor="cartCustomerLocation">
                    Delivery address<span className={styles.requiredMark}>*</span>
                  </label>
                  <textarea
                    id="cartCustomerLocation"
                    autoComplete="address-line1"
                    aria-required="true"
                    className={formStyles.textarea}
                    value={draft.customerLocation}
                    onChange={(event) => onUpdate({ customerLocation: event.target.value })}
                    placeholder="House/unit number, street, barangay, and any landmark details"
                  />
                </div>

                <div className={styles.deliveryRow}>
                  <div className={formStyles.field}>
                    <label className={formStyles.label} htmlFor="cartCityMunicipality">
                      City/Municipality<span className={styles.requiredMark}>*</span>
                    </label>
                    <input
                      id="cartCityMunicipality"
                      type="text"
                      autoComplete="address-level2"
                      aria-required="true"
                      className={formStyles.input}
                      value={draft.cityMunicipality}
                      onChange={(event) => onUpdate({ cityMunicipality: event.target.value })}
                      placeholder="e.g. Manila"
                    />
                  </div>

                  <div className={formStyles.field}>
                    <label className={formStyles.label} htmlFor="cartProvince">
                      Province<span className={styles.requiredMark}>*</span>
                    </label>
                    <select
                      id="cartProvince"
                      autoComplete="address-level1"
                      aria-required="true"
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
              </div>
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

            <HandoverTimeDetails
              fulfillmentMethod={draft.fulfillmentMethod}
              pickupAt={pickupAt}
              estimatedDeliveryAt={estimatedDeliveryAt}
            />
            <ReturnScheduleDetails
              pickupAt={pickupAt}
              returnAt={returnAt}
              rentalDays={rentalDays}
              fulfillmentMethod={draft.fulfillmentMethod}
            />
            <PriceBreakdown
              lines={lines}
              pricing={pricing}
              fulfillmentMethod={draft.fulfillmentMethod}
              pickupTime={draft.pickupTime}
            />

            <div className={styles.summaryTotal}>
              <span>Current total</span>
              <strong>
                {pricing.rentalDays > 0 ? formatPeso(pricing.finalAmount) : "Choose dates"}
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

      <ReservationFooter
        onBack={onBack}
        backDisabled={checking}
        primaryLabel={checking ? "Checking availability..." : "Continue"}
        primaryLoading={checking}
        primaryLoadingText="Checking…"
        primaryDisabled={!canContinue || checking}
        onContinue={() => void handleContinue()}
      />

      {showScheduleNotice && pickupAt && returnAt && draft.fulfillmentMethod ? (
        <RentalScheduleNoticeModal
          pickupAt={pickupAt}
          returnAt={returnAt}
          fulfillmentMethod={draft.fulfillmentMethod}
          onGoBack={() => setShowScheduleNotice(false)}
          onContinue={handleConfirmScheduleNotice}
        />
      ) : null}
    </div>
  );
}
