"use client";

import { Button } from "@/components/ui/Button";
import { forwardRef, useState, type InputHTMLAttributes } from "react";
import styles from "./PasswordInput.module.css";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className = "", ...props }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <div className={styles.wrapper}>
        <input
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          className={`${className} ${styles.input}`.trim()}
        />
        <Button variant="none"
          type="button"
          className={styles.toggle}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 4.2A10.8 10.8 0 0112 4c5.2 0 8.8 4.6 9.7 6a1.8 1.8 0 010 2c-.4.7-1.4 2-2.8 3.2M6.2 6.2C4.3 7.5 3 9.2 2.3 10.4a1.8 1.8 0 000 2C3.2 13.8 6.8 18 12 18c1.1 0 2.2-.2 3.2-.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2.3 10.4C3.2 9 6.8 4 12 4s8.8 5 9.7 6.4a1.8 1.8 0 010 2C20.8 13.8 17.2 18 12 18S3.2 13.8 2.3 12.4a1.8 1.8 0 010-2z" />
              <circle cx="12" cy="11" r="3" />
            </svg>
          )}
        </Button>
      </div>
    );
  }
);

export default PasswordInput;
