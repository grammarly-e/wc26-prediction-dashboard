import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { recomputeStandingsAndBracket } from "@/lib/admin-recompute";

// ============================================================================
// POST /api/admin/override-match-teams
//
// Manual override for a knockout match's team1_id/team2_id -- the escape
// hatch for when the automatic bracket resolver (resolveKnockoutSlots() in
// admin-recompute.ts) gets a slot wrong, e.g. because the underlying group
// standings it derived the slot from were briefly stale (see migration
// 0013's Iran -> Senegal fix for the concrete case this was built for).
//
// Locking a side (team1Locked/team2Locked = true) pins that team_id so the
// resolver leaves it untouched on every subsequent hourly sync. Unlocking
// (false) hands the side back to automatic resolution on the next recompute.
// ============================================================================

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
    team1Id: string | null;
    team2Id: string | null;
    team1Locked: boolean;
    team2Locked: boolean;
  };

  if (!body.matchId) {
    return NextResponse.json({ error: "matchId is required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("matches")
    .update({
      team1_id: body.team1Id,
      team2_id: body.team2Id,
      team1_locked: body.team1Locked,
      team2_locked: body.team2Locked,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.matchId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Re-run standings + bracket immediately so any later knockout match that
  // references this one (via "W##"/"L##", or another "3X/Y/Z" slot whose
  // eligible pool just changed) picks up the override right away, rather
  // than waiting for the next hourly sync.
  let recomputeError: string | null = null;
  try {
    await recomputeStandingsAndBracket(supabase);
  } catch (err) {
    recomputeError = err instanceof Error ? err.message : String(err);
    console.error("[override-match-teams] recompute failed:", recomputeError);
  }

  if (recomputeError) {
    return NextResponse.json({ ok: true, recomputeError }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
