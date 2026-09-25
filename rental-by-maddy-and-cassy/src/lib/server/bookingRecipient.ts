import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/lib/supabase/database.types";
import type { Booking } from "@/src/types/booking";

/**
 * The email saved on the booking (where guest checkout keeps the guest's address), falling back
 * to the account email only when that is blank. Returns "" when neither exists.
 */
export async function resolveBookingRecipientEmail(
  admin: SupabaseClient<Database>,
  booking: Booking,
): Promise<string> {
  const saved = booking.customerSnapshot.email.trim();
  if (saved) return saved;
  const { data } = await admin.auth.admin.getUserById(booking.customerId);
  return data?.user?.email?.trim() ?? "";
}
