"use client";

import {
  COURIER_NAME_MAX_LENGTH,
  COURIER_OPTIONS,
  COURIER_RESPONSIBILITY_NOTE,
  type CourierArrangement,
  type CourierOption,
  type ReturnMethod,
} from "@/src/lib/courierArrangement";
import styles from "./CourierArrangementFields.module.css";

interface CourierArrangementFieldsProps {
  /** Keeps input ids/radio names unique when several forms are on one page. */
  idPrefix: string;
  value: CourierArrangement;
  onChange: (patch: Partial<CourierArrangement>) => void;
  disabled?: boolean;
}

interface CourierPickerProps {
  idPrefix: string;
  legend: string;
  courier: CourierOption | null;
  otherName: string;
  disabled?: boolean;
  onCourierChange: (courier: CourierOption) => void;
  onOtherNameChange: (name: string) => void;
}

function CourierPicker({
  idPrefix,
  legend,
  courier,
  otherName,
  disabled,
  onCourierChange,
  onOtherNameChange,
}: CourierPickerProps) {
  const otherInputId = `${idPrefix}-other-name`;
  return (
    <div className={styles.block}>
      <fieldset className={styles.group} disabled={disabled}>
        <legend className={styles.legend}>
          {legend}
          <span className={styles.required} aria-hidden="true">*</span>
        </legend>
        <div className={styles.chipGrid}>
          {COURIER_OPTIONS.map((option) => (
            <label key={option.value} className={styles.chip}>
              <input
                type="radio"
                name={`${idPrefix}-courier`}
                value={option.value}
                checked={courier === option.value}
                required
                onChange={() => onCourierChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {courier === "other" ? (
        <div className={styles.otherField}>
          <label className={styles.otherLabel} htmlFor={otherInputId}>
            Courier name<span className={styles.required} aria-hidden="true">*</span>
          </label>
          <input
            id={otherInputId}
            type="text"
            className={styles.otherInput}
            value={otherName}
            maxLength={COURIER_NAME_MAX_LENGTH}
            aria-required="true"
            required
            disabled={disabled}
            placeholder="e.g. Move It, Transportify"
            onChange={(event) => onOtherNameChange(event.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Courier choice for delivery bookings (and their return). The customer books
 * and pays the courier directly, so nothing chosen here changes the rental
 * total -- the note says so explicitly.
 */
export default function CourierArrangementFields({
  idPrefix,
  value,
  onChange,
  disabled,
}: CourierArrangementFieldsProps) {
  function handleReturnMethodChange(method: ReturnMethod) {
    if (method === "courier") {
      // Start the return with the delivery courier preselected; the customer
      // can still pick a different one.
      onChange({
        returnMethod: method,
        returnCourier: value.returnCourier ?? value.deliveryCourier,
        returnCourierOther: value.returnCourier ? value.returnCourierOther : value.deliveryCourierOther,
      });
    } else {
      onChange({ returnMethod: method, returnCourier: null, returnCourierOther: "" });
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.notice} role="note">
        <span className={styles.noticeIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h11v9H3z" />
            <path d="M14 10h4l3 3v3h-7" />
            <circle cx="7" cy="18" r="1.6" />
            <circle cx="17" cy="18" r="1.6" />
          </svg>
        </span>
        <div>
          <strong>You book and pay for the courier</strong>
          <p>{COURIER_RESPONSIBILITY_NOTE}</p>
          <p className={styles.noticeSub}>
            Courier fees are paid directly to the courier and are not added to your rental payment or
            website total.
          </p>
        </div>
      </div>

      <CourierPicker
        idPrefix={`${idPrefix}-delivery`}
        legend="Delivery courier"
        courier={value.deliveryCourier}
        otherName={value.deliveryCourierOther}
        disabled={disabled}
        onCourierChange={(courier) =>
          onChange({
            deliveryCourier: courier,
            deliveryCourierOther: courier === "other" ? value.deliveryCourierOther : "",
          })
        }
        onOtherNameChange={(name) => onChange({ deliveryCourierOther: name })}
      />

      <div className={styles.block}>
        <fieldset className={styles.group} disabled={disabled}>
          <legend className={styles.legend}>
            How will you return the rental?<span className={styles.required} aria-hidden="true">*</span>
          </legend>
          <div className={styles.returnGrid}>
            <label className={styles.returnOption}>
              <input
                type="radio"
                name={`${idPrefix}-return-method`}
                value="courier"
                checked={value.returnMethod === "courier"}
                required
                onChange={() => handleReturnMethodChange("courier")}
              />
              <span>
                <strong>Send back by courier</strong>
                <small>You book and pay the courier for the return</small>
              </span>
            </label>
            <label className={styles.returnOption}>
              <input
                type="radio"
                name={`${idPrefix}-return-method`}
                value="dropoff"
                checked={value.returnMethod === "dropoff"}
                required
                onChange={() => handleReturnMethodChange("dropoff")}
              />
              <span>
                <strong>Return in person</strong>
                <small>Sta. Cruz, Manila · by appointment</small>
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      {value.returnMethod === "courier" ? (
        <CourierPicker
          idPrefix={`${idPrefix}-return`}
          legend="Return courier"
          courier={value.returnCourier}
          otherName={value.returnCourierOther}
          disabled={disabled}
          onCourierChange={(courier) =>
            onChange({
              returnCourier: courier,
              returnCourierOther: courier === "other" ? value.returnCourierOther : "",
            })
          }
          onOtherNameChange={(name) => onChange({ returnCourierOther: name })}
        />
      ) : null}
    </div>
  );
}
