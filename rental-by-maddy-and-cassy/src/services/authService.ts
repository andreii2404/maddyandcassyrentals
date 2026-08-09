"use client";

import type { Subscription, User } from "@supabase/supabase-js";
import { createClient } from "@/src/lib/supabase/client";
import { normalizeEmail } from "@/src/lib/authValidation";

export interface SendEmailOtpOptions {
  /** Creates a new account for this email if one does not already exist. */
  shouldCreateUser?: boolean;
  /** Optional redirect target for confirmation links / OTP emails. */
  emailRedirectTo?: string;
  /** Initial customer profile values used only when a new account is created. */
  profileData?: {
    displayName: string;
    phoneNumber: string;
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
}

export async function verifyEmailOtp(email: string, token: string): Promise<User> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: normalizeEmail(email), token, type: "email" });
  if (error || !data.user || !data.session) {
    throw new Error(error?.message ?? "The verification code could not be confirmed.");
  }
  await syncServerSession(data.session.access_token, data.session.refresh_token);
  return data.user;
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
  return data.user;
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
