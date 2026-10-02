import { normalizeEmail } from "./authValidation";

/** The Verify Email page tells customers a code lasts 10 minutes. */
export const OTP_EXPIRY_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

const STORAGE_PREFIX = "emailOtp:sentAt:";

export interface OtpStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): OtpStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(email: string): string {
  return `${STORAGE_PREFIX}${normalizeEmail(email)}`;
}

/**
 * Remembers when the most recent code was sent to this email. Every send
 * overwrites the previous value, so only the latest code's clock is tracked
 * (Supabase likewise invalidates the earlier code when a new one is issued).
 */
export function recordOtpSent(
  email: string,
  sentAt: number = Date.now(),
  storage: OtpStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(storageKey(email), String(sentAt));
  } catch {
    // Storage can be unavailable (private mode); the page falls back to load time.
  }
}

export function readOtpSentAt(
  email: string,
  storage: OtpStorage | null = defaultStorage(),
): number | null {
  try {
    const raw = storage?.getItem(storageKey(email));
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function clearOtpSent(
  email: string,
  storage: OtpStorage | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(storageKey(email));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function isOtpExpired(sentAt: number, now: number = Date.now()): boolean {
  return now - sentAt >= OTP_EXPIRY_MS;
}

export function resendCooldownRemaining(sentAt: number, now: number = Date.now()): number {
  const elapsedSeconds = Math.floor((now - sentAt) / 1000);
  return Math.min(
    OTP_RESEND_COOLDOWN_SECONDS,
    Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds),
  );
}
