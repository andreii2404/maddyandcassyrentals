import { NextResponse } from "next/server";
import { requireActiveAdmin } from "@/src/lib/server/requestSecurity";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { isValidPhoneNumber } from "@/src/lib/authValidation";

export const runtime = "nodejs";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid: targetUid } = await params;
  if (!targetUid || targetUid.length > 128) return errorResponse("The selected account is invalid.", 400);

  try {
    const { supabase, user } = await requireActiveAdmin();
    if (user.id === targetUid) {
      return errorResponse("You cannot delete the account you are currently using.", 409);
    }

    // There is no more public.admins table — "protected admin" now means a
    // user_roles row with role = 'admin' whose profile is still active,
    // mirroring private.is_admin()'s exact check.
    const { data: targetAdminRole } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("user_id", targetUid)
      .eq("role", "admin")
      .maybeSingle();
    if (targetAdminRole) {
      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("account_status")
        .eq("id", targetUid)
        .maybeSingle();
      if (targetProfile?.account_status === "active") {
        return errorResponse("Administrator accounts are protected and cannot be deleted from customer management.", 409);
      }
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(targetUid);
    if (error && !error.message.includes("not found") && !error.message.includes("User not found")) {
      throw new Error(error.message);
    }

    // profiles.id references auth.users(id) on delete cascade, so the
    // profile row (and its notifications/push subscriptions) are removed
    // automatically. Booking and payment history remain, keyed by
    // customer_id, for business record-keeping.
    await admin.rpc("log_audit_event", {
      p_action: "account.deleted",
      p_entity_type: "user",
      p_entity_id: targetUid,
      p_metadata: { bookingHistoryPreserved: true },
    });

    return NextResponse.json({ deleted: true, uid: targetUid, bookingHistoryPreserved: true });
  } catch (error) {
    console.error("Admin customer deletion failed", error);
    return errorResponse("The customer account could not be deleted. Please try again.", 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid: targetUid } = await params;
  if (!targetUid || targetUid.length > 128) return errorResponse("The selected account is invalid.", 400);

  const body = (await request.json().catch(() => null)) as
    | {
        displayName?: unknown;
        phoneNumber?: unknown;
        fullAddress?: unknown;
        accountStatus?: unknown;
        role?: unknown;
      }
    | null;
  if (!body) return errorResponse("The account update is invalid.", 400);

  try {
    const { supabase, user } = await requireActiveAdmin();

    const { data: target } = await supabase.from("profiles").select("*").eq("id", targetUid).maybeSingle();
    if (!target) return errorResponse("This user account no longer exists.", 404);

    // There is no more profiles.display_role column — the current role is
    // derived from whether a user_roles row with role = 'admin' exists.
    const { data: currentAdminRole } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("user_id", targetUid)
      .eq("role", "admin")
      .maybeSingle();
    const currentRole: "admin" | "customer" = currentAdminRole ? "admin" : "customer";

    const accountStatus = body.accountStatus === "active" || body.accountStatus === "suspended" ? body.accountStatus : target.account_status;
    const role = body.role === "admin" || body.role === "customer" ? body.role : currentRole;
    if (user.id === targetUid && (accountStatus !== "active" || role !== "admin")) {
      return errorResponse("You cannot suspend or demote the account you are using.", 409);
    }

    const clean = (value: unknown, max: number, fallback: string) =>
      typeof value === "string" ? value.trim().slice(0, max) : fallback;

    const displayName = clean(body.displayName, 150, target.display_name);
    const phoneNumber = clean(body.phoneNumber, 11, target.phone_number ?? "");
    const fullAddress = clean(body.fullAddress, 500, target.full_address ?? "");
    if (displayName.length < 2) {
      return errorResponse("Enter the account holder's full name.", 400);
    }
    if (!isValidPhoneNumber(phoneNumber)) {
      return errorResponse("Phone number must contain exactly 11 digits.", 400);
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        display_name: displayName,
        phone_number: phoneNumber,
        full_address: fullAddress,
        account_status: accountStatus,
      })
      .eq("id", targetUid);
    if (profileError) throw new Error(profileError.message);

    if (role === "admin") {
      await supabase
        .from("user_roles")
        .upsert({ user_id: targetUid, role: "admin", created_by: user.id }, { onConflict: "user_id,role" });
    } else {
      await supabase.from("user_roles").delete().eq("user_id", targetUid).eq("role", "admin");
    }

    await supabase.rpc("log_audit_event", {
      p_action: "account.updated",
      p_entity_type: "user",
      p_entity_id: targetUid,
      p_previous_values: { accountStatus: target.account_status, role: currentRole },
      p_new_values: { accountStatus, role },
    });

    return NextResponse.json({ success: true, uid: targetUid, accountStatus, role });
  } catch (error) {
    console.error("Admin account update failed", error);
    return errorResponse("The account could not be updated.", 500);
  }
}
