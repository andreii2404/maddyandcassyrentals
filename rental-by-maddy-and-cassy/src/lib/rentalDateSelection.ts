import {
  differenceInCalendarDays,
  eachDayOfInterval,
  isBefore,
  isSameDay,
} from "date-fns";

export interface RentalDateRange {
  startDate: Date | null;
  endDate: Date | null;
}

interface SelectRentalDateRangeInput extends RentalDateRange {
  selectedDate: Date;
  isDisabled: (day: Date) => boolean;
  maxRentalDays?: number;
}

export interface RentalDateRangeSelectionResult {
  range: RentalDateRange;
  error: string | null;
}

/**
 * Applies one calendar click to a rental range. A restored start day remains
 * removable even when availability has changed since it was saved; every new
 * date and every proposed range still uses the availability guard.
 */
export function selectRentalDateRange({
  startDate,
  endDate,
  selectedDate,
  isDisabled,
  maxRentalDays = 30,
}: SelectRentalDateRangeInput): RentalDateRangeSelectionResult {
  const currentRange = { startDate, endDate };

  if (startDate && isSameDay(selectedDate, startDate)) {
    return { range: { startDate: null, endDate: null }, error: null };
  }

  if (isDisabled(selectedDate)) {
    return { range: currentRange, error: null };
  }

  if (!startDate || !endDate) {
    return {
      range: { startDate: selectedDate, endDate: selectedDate },
      error: null,
    };
  }

  if (isBefore(selectedDate, startDate)) {
    return {
      range: { startDate: selectedDate, endDate: selectedDate },
      error: null,
    };
  }

  const daySpan = differenceInCalendarDays(selectedDate, startDate) + 1;
  if (daySpan > maxRentalDays) {
    return {
      range: currentRange,
      error: `Maximum rental period is ${maxRentalDays} days.`,
    };
  }

  if (eachDayOfInterval({ start: startDate, end: selectedDate }).some(isDisabled)) {
    return {
      range: currentRange,
      error: "That range includes an unavailable date. Please choose another end date.",
    };
  }

  return {
    range: { startDate, endDate: selectedDate },
    error: null,
  };
}
