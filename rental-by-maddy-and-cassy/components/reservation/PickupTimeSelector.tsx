"use client";

import ClockIcon from "@/components/icons/ClockIcon";
import {
  createPickupTimeValue,
  pickupTimeParts,
  type PickupPeriod,
} from "@/src/lib/rentalTiming";
import styles from "./StepRentalDetails.module.css";

interface PickupTimeSelectorProps {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
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
}: PickupTimeSelectorProps) {
  const parts = pickupTimeParts(value);
  const hour = parts?.hour ?? "";
  const minute = parts?.minute ?? "00";
  const period = parts?.period ?? "AM";
  const minuteOptions = STANDARD_MINUTES.includes(minute)
    ? STANDARD_MINUTES
    : [...STANDARD_MINUTES, minute].sort();

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
          <button type="button" className={styles.clearTimeButton} onClick={() => onChange("")}>
            Clear
          </button>
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
            {minuteOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
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
          {QUICK_TIMES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={value === option.value}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.normalWindowNote}>
        Standard service window: <strong>9:00 AM–7:00 PM</strong>. You may choose any
        future time; before 9:00 AM or after 7:00 PM adds ₱100.
      </p>
    </div>
  );
}
