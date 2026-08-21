"use client";

import { useState } from "react";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isBefore,
  isSameDay,
  isWithinInterval,
  isSameMonth,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import ArrowLeftIcon from "@/components/icons/ArrowLeftIcon";
import { toDateKey } from "@/src/services/availabilityService";
import styles from "./DateRangePicker.module.css";

interface DateRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  onChange: (range: { startDate: Date | null; endDate: Date | null }) => void;
  disabledDateKeys: Set<string>;
  /**
   * Subset of disabledDateKeys where every blocking booking has already been
   * approved/confirmed/released by admin (vs. still pending review). Colored
   * grey instead of red — still unselectable, same as any disabled date.
   */
  confirmedDateKeys?: Set<string>;
  maxRentalDays?: number;
  singleDate?: boolean;
  hideSelectionSummary?: boolean;
  compact?: boolean;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onChange,
  disabledDateKeys,
  confirmedDateKeys,
  maxRentalDays = 30,
  singleDate = false,
  hideSelectionSummary = false,
  compact = false,
}: DateRangePickerProps) {
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(startDate ?? new Date()));
  const [error, setError] = useState<string | null>(null);
  const today = startOfDay(new Date());

  function isPast(day: Date): boolean {
    return isBefore(day, today);
  }

  function isBooked(day: Date): boolean {
    return disabledDateKeys.has(toDateKey(day));
  }

  function isConfirmed(day: Date): boolean {
    return !!confirmedDateKeys?.has(toDateKey(day));
  }

  function isDisabled(day: Date): boolean {
    return isPast(day) || isBooked(day);
  }

  function handleDayClick(day: Date) {
    if (isDisabled(day)) return;

    if (singleDate) {
      setError(null);
      const isSelectingCurrentDay = !!startDate && isSameDay(day, startDate);
      onChange(
        isSelectingCurrentDay
          ? { startDate: null, endDate: null }
          : { startDate: day, endDate: day },
      );
      return;
    }

    // A first click is already a valid one-day rental.
    if (!startDate || !endDate || !isSameDay(startDate, endDate)) {
      setError(null);
      onChange({ startDate: day, endDate: day });
      return;
    }

    if (isSameDay(day, startDate)) {
      setError(null);
      onChange({ startDate: null, endDate: null });
      return;
    }

    if (isBefore(day, startDate)) {
      setError(null);
      onChange({ startDate: day, endDate: day });
      return;
    }

    const daySpan = differenceInCalendarDays(day, startDate) + 1;
    if (daySpan > maxRentalDays) {
      setError(`Maximum rental period is ${maxRentalDays} days.`);
      return;
    }

    const blockedDate = eachDayOfInterval({ start: startDate, end: day }).find(isDisabled);
    if (blockedDate) {
      setError("That range includes an unavailable date. Please choose another end date.");
      return;
    }

    setError(null);
    onChange({ startDate, endDate: day });
  }

  const selectionEnd = endDate ?? startDate;
  // Reservation dates may carry the customer's pickup time (for example,
  // Aug 13 at 7:00 PM), while calendar cells represent midnight. Compare
  // whole calendar days so the selected start day is included in the range.
  const selectionStartDay = startDate ? startOfDay(startDate) : null;
  const selectionEndDay = selectionEnd ? startOfDay(selectionEnd) : null;
  const monthStart = startOfMonth(visibleMonth);
  const monthEnd = endOfMonth(visibleMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const leadingBlanks = getDay(monthStart);

  return (
    <div className={`${styles.wrapper} ${compact ? styles.compact : ""}`}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => setVisibleMonth((current) => subMonths(current, 1))}
          aria-label="Previous month"
        >
          <ArrowLeftIcon size={14} />
        </button>
        <p className={styles.monthLabel}>{format(visibleMonth, "MMMM yyyy")}</p>
        <button
          type="button"
          className={`${styles.navButton} ${styles.navButtonNext}`}
          onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
          aria-label="Next month"
        >
          <ArrowLeftIcon size={14} />
        </button>
      </div>

      <div className={styles.weekdays} aria-hidden="true">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>

      <div className={styles.grid} role="grid">
        {Array.from({ length: leadingBlanks }).map((_, index) => (
          <span key={`blank-${index}`} className={styles.blank} aria-hidden="true" />
        ))}
        {daysInMonth.map((day) => {
          const past = isPast(day);
          const booked = !past && isBooked(day);
          const confirmed = booked && isConfirmed(day);
          const disabled = past || booked;
          const selected =
            !!selectionStartDay && !!selectionEndDay
              ? isWithinInterval(day, { start: selectionStartDay, end: selectionEndDay })
              : false;

          let statusLabel = "";
          if (selected) statusLabel = ", selected";
          else if (past) statusLabel = ", past date";
          else if (confirmed) statusLabel = ", reserved and confirmed, unavailable";
          else if (booked) statusLabel = ", temporarily reserved, pending review";
          else statusLabel = ", available";

          return (
            <button
              key={day.toISOString()}
              type="button"
              role="gridcell"
              disabled={disabled}
              aria-current={selected ? "date" : undefined}
              aria-selected={selected}
              data-selected={selected ? "true" : undefined}
              aria-label={`${format(day, "MMMM d, yyyy")}${statusLabel}`}
              className={[
                styles.day,
                !isSameMonth(day, visibleMonth) ? styles.outsideMonth : "",
                !selected && past ? styles.dayPast : "",
                !selected && confirmed ? styles.dayConfirmed : "",
                !selected && booked && !confirmed ? styles.dayBooked : "",
                !selected && !disabled ? styles.dayAvailable : "",
                selected ? styles.dayEdge : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => handleDayClick(day)}
            >
              <span>{format(day, "d")}</span>
              {selected ? (
                <span className={styles.selectedMark} aria-hidden="true">✓</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {hideSelectionSummary ? null : startDate && selectionEnd ? (
        <p className={styles.selectionSummary} role="status">
          <span className={styles.selectionIcon} aria-hidden="true">✓</span>
          <span>
            <small>
              {singleDate
                ? "Selected pickup date"
                : isSameDay(startDate, selectionEnd)
                  ? "Selected rental date"
                  : "Selected rental dates"}
            </small>
            <strong>
              {singleDate || isSameDay(startDate, selectionEnd)
                ? format(startDate, "EEEE, MMMM d, yyyy")
                : `${format(startDate, "MMM d, yyyy")} – ${format(selectionEnd, "MMM d, yyyy")}`}
            </strong>
          </span>
        </p>
      ) : (
        <p className={styles.selectionPrompt}>Select an available date from the calendar.</p>
      )}

      {error ? (
        <p className={styles.errorMessage} role="alert">
          {error}
        </p>
      ) : null}

      <p className={styles.legend}>
        <span className={styles.legendSwatch} data-variant="available" /> Available
        <span className={styles.legendSwatch} data-variant="booked" /> Pending review
        <span className={styles.legendSwatch} data-variant="confirmed" /> Confirmed
        <span className={styles.legendSwatch} data-variant="selected" /> Selected
        <span className={styles.legendSwatch} data-variant="disabled" /> Past
      </p>
    </div>
  );
}
