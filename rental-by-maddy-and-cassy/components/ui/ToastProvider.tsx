"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import styles from "./Toast.module.css";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    // Failed actions (e.g. a blocked submit) can fire the same toast more
    // than once in quick succession -- collapse those into a single toast
    // instead of stacking duplicates.
    setToasts((current) => {
      if (current.some((toast) => toast.message === message && toast.variant === variant)) {
        return current;
      }
      const id = nextId++;
      setTimeout(() => {
        setToasts((later) => later.filter((toast) => toast.id !== id));
      }, 5000);
      return [...current, { id, message, variant }];
    });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={styles.container} aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`${styles.toast} ${styles[toast.variant]}`} role="status">
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
