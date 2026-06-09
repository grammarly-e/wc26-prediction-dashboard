import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { MatchStatus } from "@/lib/types";

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

export async function POST(request: Request) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    matchId: string;
    homeScore: number | null;
    awayScore: number | null;
    status: MatchStatus;
  };

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("matches")
    .update({
      home_score: body.homeScore,
      away_score: body.awayScore,
      status: body.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.matchId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
