"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/Button";
import { feedbackNextStep, friendlyMessage, type FeedbackVariant } from "@/src/lib/friendlyMessage";
import styles from "./Feedback.module.css";

/**
 * Global feedback popup. Every success, warning, error and confirmation message in
 * the app goes through `showToast` (also exported as `showFeedback`), which now opens
 * a centered popup instead of a corner toast. The name is kept so existing callers
 * keep working unchanged.
 */
export type ToastVariant = FeedbackVariant;

export interface FeedbackOptions {
  /** Overrides the default title for the variant. */
  title?: string;
  /** Overrides the "what you can do next" line. Pass null to hide it. */
  nextStep?: string | null;
  /** Adds a "Try Again" button. */
  onRetry?: () => void;
  /** Adds a "Go Back" button. */
  onGoBack?: () => void;
  /** Adds a "Continue" button. */
  onContinue?: () => void;
  /** Runs when the popup is dismissed with the OK / Close button or Escape. */
  onClose?: () => void;
}

interface FeedbackItem {
  id: number;
  variant: FeedbackVariant;
  title: string;
  message: string;
  nextStep: string | null;
  options: FeedbackOptions;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant, options?: FeedbackOptions) => void;
  showFeedback: (message: string, variant?: ToastVariant, options?: FeedbackOptions) => void;
}

const noop = () => {};

const ToastContext = createContext<ToastContextValue>({
  showToast: noop,
  showFeedback: noop,
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export const useFeedback = useToast;

const DEFAULT_TITLES: Record<FeedbackVariant, string> = {
  success: "All done!",
  error: "Something went wrong",
  warning: "Please check this",
  info: "Just so you know",
};

function VariantIcon({ variant }: { variant: FeedbackVariant }) {
  const common = {
    width: 30,
    height: 30,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (variant === "success") {
    return (
      <svg {...common}>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  }
  if (variant === "error") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </svg>
    );
  }
  if (variant === "warning") {
    return (
      <svg {...common}>
        <path d="M12 4l9 16H3L12 4z" />
        <path d="M12 10v4M12 17.5v.01" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.01" />
    </svg>
  );
}

interface FeedbackDialogProps {
  item: FeedbackItem;
  onDismiss: (afterClose?: () => void) => void;
}

function FeedbackDialog({ item, onDismiss }: FeedbackDialogProps) {
  const { variant, options } = item;
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const dismissRef = useRef(onDismiss);
  const closeRef = useRef(options.onClose);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    dismissRef.current = onDismiss;
    closeRef.current = options.onClose;
  }, [onDismiss, options.onClose]);

  const primary = options.onRetry
    ? { label: "Try Again", run: options.onRetry }
    : options.onContinue
      ? { label: "Continue", run: options.onContinue }
      : { label: variant === "error" ? "Close" : "OK", run: options.onClose };
  const secondary = options.onGoBack
    ? { label: "Go Back", run: options.onGoBack }
    : options.onRetry || options.onContinue
      ? { label: "Close", run: options.onClose }
      : null;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    primaryRef.current?.focus();

    // Runs in the capture phase and stops the event so a form modal that is open
    // underneath does not also react to Escape or Tab while this popup is on top.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismissRef.current(closeRef.current);
        return;
      }
      if (event.key !== "Tab") return;
      event.stopPropagation();
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        className={`${styles.dialog} ${styles[variant]}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
      >
        <div className={styles.icon}>
          <VariantIcon variant={variant} />
        </div>
        <h2 id={titleId} className={styles.title}>
          {item.title}
        </h2>
        <p id={messageId} className={styles.message}>
          {item.message}
        </p>
        {item.nextStep ? <p className={styles.nextStep}>{item.nextStep}</p> : null}
        <div className={styles.actions}>
          {secondary ? (
            <Button variant="secondary" onClick={() => onDismiss(secondary.run)}>
              {secondary.label}
            </Button>
          ) : null}
          <Button ref={primaryRef} variant="primary" onClick={() => onDismiss(primary.run)}>
            {primary.label}
          </Button>
        </div>
      </div>
    </div>
  );
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<FeedbackItem[]>([]);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info", options: FeedbackOptions = {}) => {
      const friendly = friendlyMessage(message, variant);
      // Failed actions (e.g. a blocked submit) can fire the same message more than
      // once in quick succession -- collapse those into a single popup instead of
      // stacking duplicates.
      setQueue((current) => {
        if (current.some((item) => item.message === friendly && item.variant === variant)) {
          return current;
        }
        const item: FeedbackItem = {
          id: nextId++,
          variant,
          title: options.title ?? DEFAULT_TITLES[variant],
          message: friendly,
          nextStep: options.nextStep === undefined ? feedbackNextStep(variant, friendly) : options.nextStep,
          options,
        };
        return [...current, item];
      });
    },
    [],
  );

  const dismiss = useCallback((afterClose?: () => void) => {
    setQueue((current) => current.slice(1));
    afterClose?.();
  }, []);

  const value = useMemo(() => ({ showToast, showFeedback: showToast }), [showToast]);
  const active = queue[0];

  return (
    <ToastContext.Provider value={value}>
      {children}
      {active ? <FeedbackDialog key={active.id} item={active} onDismiss={dismiss} /> : null}
    </ToastContext.Provider>
  );
}
