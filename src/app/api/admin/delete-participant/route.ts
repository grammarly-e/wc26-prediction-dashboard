import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

export async function POST(request: Request) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { participantId } = await request.json() as { participantId: string };

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("participants")
    .delete()
    .eq("id", participantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
