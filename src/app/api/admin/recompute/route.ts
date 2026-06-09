import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { recomputeAll } from "@/lib/admin-recompute";

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

export async function POST() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleClient();
    const result = await recomputeAll(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
