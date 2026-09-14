"use client";

import { Button } from "@/components/ui/Button";
import styles from "./RentalDurationSelector.module.css";

interface RentalDurationSelectorProps {
  days: number;
  onChange: (days: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export default function RentalDurationSelector({
  days,
  onChange,
  min = 1,
  max = 30,
  disabled = false,
}: RentalDurationSelectorProps) {
  function decrement() {
    onChange(Math.max(min, days - 1));
  }

  function increment() {
    onChange(Math.min(max, days + 1));
  }

  function handleInputChange(value: string) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    onChange(Math.min(max, Math.max(min, Math.round(parsed))));
  }

  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor="rental-duration">
        Rental Duration
      </label>
      <div className={styles.stepper}>
        <Button variant="none"
          type="button"
          className={styles.stepButton}
          onClick={decrement}
          disabled={disabled || days <= min}
          aria-label="Decrease rental days"
        >
          −
        </Button>
        <input
          id="rental-duration"
          type="number"
          className={styles.input}
          value={days}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => handleInputChange(event.target.value)}
          aria-label="Number of rental days"
        />
        <Button variant="none"
          type="button"
          className={styles.stepButton}
          onClick={increment}
          disabled={disabled || days >= max}
          aria-label="Increase rental days"
        >
          +
        </Button>
        <span className={styles.unitLabel}>{days === 1 ? "day" : "days"}</span>
      </div>
    </div>
  );
}
