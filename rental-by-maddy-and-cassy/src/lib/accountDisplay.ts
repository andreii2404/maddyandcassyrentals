/**
 * profiles.contact_email is only ever empty for guest/anonymous accounts —
 * every registered sign-up requires and stores an email (see SignUpForm).
 * Guest checkout creates a Supabase anonymous auth user, whose trigger-created
 * profile row has no email and a literal "Customer" display_name.
 */
export interface DisplayableAccount {
  displayName?: string | null;
  email?: string | null;
}

export function isGuestAccount(account: DisplayableAccount): boolean {
  return !account.email?.trim();
}

/** Resolves the best identifying label for a user account per the accounts-page display rules. */
export function resolveAccountName(account: DisplayableAccount): string {
  if (isGuestAccount(account)) return "Guest";
  if (account.displayName?.trim()) return account.displayName.trim();
  if (account.email?.trim()) return account.email.trim();
  return "Customer";
}
