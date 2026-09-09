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

/** The three account categories shown on the User Accounts page. */
export type AccountType = "Admin" | "Account" | "Guest";

export interface ClassifiableAccount extends DisplayableAccount {
  firstName?: string | null;
  lastName?: string | null;
  /** True for a guest-checkout contact record rather than a registered account. */
  isGuestContact?: boolean | null;
}

/**
 * "Customer" is the placeholder display_name the sign-up trigger writes when a
 * guest checkout has not yet supplied a real name, so it is never shown as one.
 */
const PLACEHOLDER_DISPLAY_NAME = "customer";

/**
 * The person's actual name, taken from their account or captured booking
 * contact details. Returns "Not provided" only when no real name was recorded.
 */
export function resolveCustomerName(account: ClassifiableAccount): string {
  const fullName = [account.firstName, account.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (fullName) return fullName;

  const displayName = account.displayName?.trim();
  if (displayName && displayName.toLowerCase() !== PLACEHOLDER_DISPLAY_NAME) {
    return displayName;
  }

  return "Not provided";
}

/**
 * Categorises an account for the User Accounts page. A registered customer has
 * a stored contact email and is not flagged as a guest-checkout contact record.
 */
export function resolveAccountType(
  account: ClassifiableAccount,
  isAdmin: boolean,
): AccountType {
  if (isAdmin) return "Admin";
  if (!account.email?.trim() || account.isGuestContact === true) return "Guest";
  return "Account";
}
