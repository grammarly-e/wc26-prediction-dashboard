// POST /api/admin/award-winner
// Body: { categoryKey: string; winnerName: string }
//
// Upserts a declared award winner into the award_winners table.
// No automatic scoring — this is display-only data that appears
// on the leaderboard page alongside participants' predictions.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

const VALID_CATEGORY_KEYS = new Set([
  "golden_boot",
  "silver_boot",
  "bronze_boot",
  "golden_ball",
  "silver_ball",
  "bronze_ball",
  "best_young_player",
]);

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

export async function POST(request: Request) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { categoryKey?: string; winnerName?: string };

  if (!body.categoryKey || !VALID_CATEGORY_KEYS.has(body.categoryKey)) {
    return NextResponse.json({ error: "Invalid category key" }, { status: 400 });
  }
  if (!body.winnerName?.trim()) {
    return NextResponse.json({ error: "winnerName is required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("award_winners")
    .upsert(
      { category_key: body.categoryKey, winner_name: body.winnerName.trim(), declared_at: new Date().toISOString() },
      { onConflict: "category_key" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { categoryKey?: string };
  if (!body.categoryKey || !VALID_CATEGORY_KEYS.has(body.categoryKey)) {
    return NextResponse.json({ error: "Invalid category key" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("award_winners")
    .delete()
    .eq("category_key", body.categoryKey);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
