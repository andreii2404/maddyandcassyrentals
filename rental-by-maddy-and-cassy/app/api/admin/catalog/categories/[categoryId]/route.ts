import { NextResponse } from "next/server";
import { enforceRateLimit, requireActiveAdmin, RequestSecurityError } from "@/src/lib/server/requestSecurity";

export const runtime = "nodejs";

function parseCategoryInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CATEGORY_INPUT");
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  const sortOrder = Number(input.sortOrder ?? 0);
  if (!name || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) {
    throw new Error("INVALID_CATEGORY_INPUT");
  }
  return { name, description, sortOrder };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ categoryId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-categories", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { categoryId } = await params;
    const input = parseCategoryInput(await request.json());

    const { data: duplicate } = await supabase
      .from("categories")
      .select("id")
      .ilike("name", input.name)
      .neq("id", categoryId)
      .maybeSingle();
    if (duplicate) return NextResponse.json({ error: "A category with this name already exists." }, { status: 409 });

    const { error } = await supabase
      .from("categories")
      .update({ name: input.name, description: input.description || null, sort_order: input.sortOrder })
      .eq("id", categoryId);
    if (error) throw new Error(error.message);

    await supabase.rpc("log_audit_event", {
      p_action: "catalog.category_updated",
      p_entity_type: "category",
      p_entity_id: categoryId,
      p_new_values: { name: input.name, sortOrder: input.sortOrder },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "INVALID_CATEGORY_INPUT") {
      return NextResponse.json({ error: "Enter a valid category name and display order." }, { status: 400 });
    }
    console.error("Category update failed", error);
    return NextResponse.json({ error: "The category could not be updated." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ categoryId: string }> },
): Promise<NextResponse> {
  try {
    enforceRateLimit(request, "admin-categories", 30, 60_000);
    const { supabase } = await requireActiveAdmin();
    const { categoryId } = await params;

    const { count, error: countError } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("category_id", categoryId);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Move or remove the products in this category before deleting it." },
        { status: 409 },
      );
    }

    const { error } = await supabase.from("categories").delete().eq("id", categoryId);
    if (error) throw new Error(error.message);
    await supabase.rpc("log_audit_event", {
      p_action: "catalog.category_deleted",
      p_entity_type: "category",
      p_entity_id: categoryId,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Category deletion failed", error);
    return NextResponse.json({ error: "The category could not be deleted." }, { status: 500 });
  }
}
