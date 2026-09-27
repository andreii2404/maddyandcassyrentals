"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import ClockIcon from "@/components/icons/ClockIcon";
import {
  createPickupTimeValue,
  pickupTimeParts,
  type PickupPeriod,
  type PickupUnavailabilityReason,
} from "@/src/lib/rentalTiming";
import styles from "./StepRentalDetails.module.css";

const REASON_TOOLTIP: Record<PickupUnavailabilityReason, string> = {
  booked: "Booked during this time.",
  buffer: "Blocked by the required 2-hour preparation period.",
};

interface PickupTimeSelectorProps {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  /**
   * "HH:MM" times that are already occupied or still inside the 2-hour
   * preparation buffer for the currently selected date/quantity/item(s).
   * Undefined (not yet computed) disables nothing; an empty set means every
   * time is open.
   */
  unavailableTimes?: Set<string>;
  /**
   * Same blocked times as `unavailableTimes`, plus why each is blocked, so
   * the Quick Select buttons can show a customer-friendly tooltip and the
   * correct red/gray styling. Falls back to a generic "unavailable" reason
   * for a time present in `unavailableTimes` but missing here.
   */
  unavailableReasons?: Map<string, PickupUnavailabilityReason>;
}

const QUICK_TIMES = [
  { value: "09:00", label: "9:00 AM" },
  { value: "12:00", label: "12:00 PM" },
  { value: "15:00", label: "3:00 PM" },
  { value: "18:00", label: "6:00 PM" },
  { value: "19:00", label: "7:00 PM" },
] as const;

const STANDARD_MINUTES = Array.from(
  { length: 12 },
  (_, index) => String(index * 5).padStart(2, "0"),
);

export default function PickupTimeSelector({
  idPrefix,
  value,
  onChange,
  invalid = false,
  unavailableTimes,
  unavailableReasons,
}: PickupTimeSelectorProps) {
  const parts = pickupTimeParts(value);
  const hour = parts?.hour ?? "";
  const minute = parts?.minute ?? "00";
  const period = parts?.period ?? "AM";
  const minuteOptions = STANDARD_MINUTES.includes(minute)
    ? STANDARD_MINUTES
    : [...STANDARD_MINUTES, minute].sort();
  const isTimeUnavailable = (candidate: string) => !!unavailableTimes?.has(candidate);
  // Tracks which blocked Quick Select button's tooltip a tap opened, since
  // touch devices have no hover and disabled/aria-disabled buttons don't
  // reliably receive focus on tap (notably iOS Safari).
  const [tappedTooltip, setTappedTooltip] = useState<string | null>(null);

  function update(nextHour: string, nextMinute: string, nextPeriod: PickupPeriod) {
    if (!nextHour) {
      onChange("");
      return;
    }
    onChange(createPickupTimeValue(nextHour, nextMinute, nextPeriod));
  }

  return (
    <div className={styles.timePicker} data-invalid={invalid ? "true" : undefined}>
      <div className={styles.timePickerHeader}>
        <span className={styles.timePickerIcon}><ClockIcon size={20} /></span>
        <span>
          <small>{parts ? "Selected pickup / delivery time" : "Choose your time"}</small>
          <strong>{parts ? `${parts.hour}:${parts.minute} ${parts.period}` : "No time selected"}</strong>
        </span>
        {parts ? (
          <Button variant="none" type="button" className={styles.clearTimeButton} onClick={() => onChange("")}>
            Clear
          </Button>
        ) : null}
      </div>

      <div className={styles.timeSelectRow} aria-label="Custom pickup or delivery time">
        <label htmlFor={`${idPrefix}-hour`}>
          <span>Hour</span>
          <select
            id={`${idPrefix}-hour`}
            value={hour}
            onChange={(event) => update(event.target.value, minute, period)}
          >
            <option value="">--</option>
            {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <span className={styles.timeSeparator} aria-hidden="true">:</span>

        <label htmlFor={`${idPrefix}-minute`}>
          <span>Minute</span>
          <select
            id={`${idPrefix}-minute`}
            value={minute}
            disabled={!hour}
            onChange={(event) => update(hour, event.target.value, period)}
          >
            {minuteOptions.map((option) => {
              const candidate = hour ? createPickupTimeValue(hour, option, period) : "";
              const blocked = candidate ? isTimeUnavailable(candidate) : false;
              return (
                <option key={option} value={option} disabled={blocked}>
                  {blocked ? `${option} (unavailable)` : option}
                </option>
              );
            })}
          </select>
        </label>

        <label htmlFor={`${idPrefix}-period`}>
          <span>Period</span>
          <select
            id={`${idPrefix}-period`}
            value={period}
            disabled={!hour}
            onChange={(event) => update(hour, minute, event.target.value as PickupPeriod)}
          >
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </label>
      </div>

      <div className={styles.quickTimes} aria-label="Suggested pickup or delivery times">
        <span>Quick select</span>
        <div>
          {QUICK_TIMES.map((option) => {
            const blocked = isTimeUnavailable(option.value);
            const reason = unavailableReasons?.get(option.value);
            const tooltipText = blocked
              ? reason
                ? REASON_TOOLTIP[reason]
                : "This time is unavailable."
              : undefined;
            const tooltipId = blocked ? `${idPrefix}-quick-${option.value.replace(":", "")}-tip` : undefined;
            const tooltipOpen = blocked && tappedTooltip === option.value;
            return (
              <span key={option.value} className={styles.quickTimeWrap} data-open={tooltipOpen ? "true" : undefined}>
                <Button
                  variant="none"
                  type="button"
                  aria-pressed={value === option.value}
                  aria-disabled={blocked || undefined}
                  aria-describedby={tooltipId}
                  className={styles.quickTimeButton}
                  data-reason={blocked ? reason ?? "unavailable" : undefined}
                  onClick={() => {
                    if (blocked) {
                      setTappedTooltip((current) => (current === option.value ? null : option.value));
                      return;
                    }
                    setTappedTooltip(null);
                    onChange(option.value);
                  }}
                  onBlur={() => setTappedTooltip((current) => (current === option.value ? null : current))}
                >
                  {option.label}
                </Button>
                {tooltipText ? (
                  <span role="tooltip" id={tooltipId} className={styles.quickTimeTooltip}>
                    {tooltipText}
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      </div>

      <p className={styles.normalWindowNote}>
        Standard service window: <strong>9:00 AM–7:00 PM</strong>. You may choose any
        future time; before 9:00 AM or after 7:00 PM adds ₱100.
      </p>
    </div>
  );
}
