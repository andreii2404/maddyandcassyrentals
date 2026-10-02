"use client";

import type { Subscription, User } from "@supabase/supabase-js";
import { createClient } from "@/src/lib/supabase/client";
import { normalizeEmail } from "@/src/lib/authValidation";
import { recordOtpSent } from "@/src/lib/emailOtp";

export interface SendEmailOtpOptions {
  /** Creates a new account for this email if one does not already exist. */
  shouldCreateUser?: boolean;
  /** Optional redirect target for confirmation links / OTP emails. */
  emailRedirectTo?: string;
  /** Initial customer profile values used only when a new account is created. */
  profileData?: {
    displayName: string;
    phoneNumber: string;
    birthDate: string;
  };
}

async function syncServerSession(accessToken: string, refreshToken: string): Promise<void> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, refreshToken }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      typeof body?.error === "string" ? body.error : "Your browser session could not be saved.",
    );
  }
}

/**
 * Sends a 6-digit one-time code to the given email via Supabase's native
 * email OTP delivery. Used for both customer sign-in (existing accounts
 * only) and sign-up (creates the account on first verified code) — see
 * app/(auth)/sign-in and app/(auth)/sign-up.
 */
export async function sendEmailOtp(
  email: string,
  options: SendEmailOtpOptions = {},
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizeEmail(email),
    options: {
      shouldCreateUser: options.shouldCreateUser ?? false,
      emailRedirectTo: options.emailRedirectTo,
      data: options.profileData
        ? {
            display_name: options.profileData.displayName.trim(),
            phone_number: options.profileData.phoneNumber.trim(),
            birth_date: options.profileData.birthDate,
          }
        : undefined,
    },
  });
  if (error) {
    const normalized = error.message.toLowerCase();
    if (!options.shouldCreateUser && normalized.includes("signups not allowed for otp")) {
      throw new Error(
        "No customer account was found for that email. Please create an account first.",
      );
    }
    throw new Error(error.message);
  }
  // Supabase invalidates any earlier code for this email when a new one is
  // issued, so only the newest send time is relevant to the Verify Email page.
  recordOtpSent(email);
}

/**
 * Raised when Supabase accepted the one-time code (which is now consumed) but
 * the session could not be copied to the server cookies. Retrying the same code
 * would always fail, so callers should resume the verified session instead.
 */
export class VerifiedSessionSyncError extends Error {
  constructor() {
    super("Your code was accepted, but we could not finish signing you in. Please try again.");
    this.name = "VerifiedSessionSyncError";
  }
}

async function persistVerifiedSession(accessToken: string, refreshToken: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await syncServerSession(accessToken, refreshToken);
      return;
    } catch {
      // Retry once, then surface a dedicated error below.
    }
  }
  throw new VerifiedSessionSyncError();
}

export async function verifyEmailOtp(email: string, token: string): Promise<User> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: normalizeEmail(email), token, type: "email" });
  if (error || !data.user || !data.session) {
    throw new Error(error?.message ?? "The verification code could not be confirmed.");
  }
  await persistVerifiedSession(data.session.access_token, data.session.refresh_token);
  return data.user;
}

/**
 * Finishes sign-in for a code Supabase already accepted in this browser, without
 * spending another code. Used after a `VerifiedSessionSyncError`.
 */
export async function resumeVerifiedSession(): Promise<User | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  await persistVerifiedSession(data.session.access_token, data.session.refresh_token);
  return data.session.user;
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
  if (error || !data.user || !data.session) {
    const normalized = error?.message.toLowerCase() ?? "";
    if (normalized.includes("invalid login credentials")) {
      throw new Error("The email or password is incorrect.");
    }
    if (normalized.includes("email not confirmed")) {
      throw new Error("Confirm this account's email before signing in.");
    }
    throw new Error(error?.message ?? "Could not sign in.");
  }
  await syncServerSession(data.session.access_token, data.session.refresh_token);
  return data.user;
}

/**
 * Creates a temporary Supabase user for a real guest checkout. The session is
 * also copied into the server cookies so protected payment and document routes
 * can authorize the same guest booking after redirects.
 */
export async function startGuestCheckout(): Promise<User> {
  const supabase = createClient();

  // Reuse a still-valid guest session rather than creating a second anonymous
  // user that would orphan the first one's bookings and uploaded documents.
  const { data: existing } = await supabase.auth.getUser();
  if (existing.user?.is_anonymous) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session) {
      await syncServerSession(sessionData.session.access_token, sessionData.session.refresh_token);
      await ensureGuestProfile();
      return existing.user;
    }
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user || !data.session) {
    if (error?.message.toLowerCase().includes("anonymous sign-ins are disabled")) {
      throw new Error(
        "Guest checkout is not enabled for this store yet. Please sign in or create an account to continue.",
      );
    }
    throw new Error(
      error?.message ?? "Guest checkout could not be started. Please sign in or create an account.",
    );
  }
  await syncServerSession(data.session.access_token, data.session.refresh_token);
  await ensureGuestProfile();
  return data.user;
}

/**
 * Makes sure the current guest session has its profile row. Guest checkout
 * saves contact details onto that row, so a guest session whose profile is
 * missing would otherwise fail at payment submission. Safe to call repeatedly.
 */
export async function ensureGuestProfile(): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/guest/profile", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Your guest checkout session could not be prepared. Check your connection and try again.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : "Your guest checkout session could not be prepared. Please try again.",
    );
  }
}

export async function requestPasswordReset(
  email: string,
  redirectPath = "/reset-password",
): Promise<void> {
  const supabase = createClient();
  const safePath = redirectPath.startsWith("/reset-password")
    ? redirectPath
    : "/reset-password";
  let redirectTo: string | undefined;
  if (typeof window !== "undefined") {
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", safePath);
    redirectTo = callbackUrl.toString();
  }
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo,
  });
  if (error) throw new Error(error.message);
}

export async function logout(): Promise<void> {
  const { error } = await createClient().auth.signOut();
  if (error) throw new Error(error.message);
}

export function subscribeToAuthChanges(
  callback: (user: User | null) => void,
): () => void {
  const supabase = createClient();
  const {
    data: { subscription },
  }: { data: { subscription: Subscription } } = supabase.auth.onAuthStateChange(
    (_event, session) => {
      callback(session?.user ?? null);
    },
  );
  return () => subscription.unsubscribe();
}

export async function getCurrentUser(): Promise<User | null> {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  return user;
}
