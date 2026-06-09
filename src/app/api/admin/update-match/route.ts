import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { scoreMatchPrediction } from "@/lib/scoring";
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

  // 1. Update the match record.
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

  // 2. If the match is now finished with a real score, score all predictions
  //    for it immediately — don't wait for the API sync (which would overwrite
  //    manually-entered scores anyway).
  if (body.status === "finished" && body.homeScore != null && body.awayScore != null) {
    const { data: predictions, error: predErr } = await supabase
      .from("match_predictions")
      .select("id, predicted_home, predicted_away")
      .eq("match_id", body.matchId);

    if (!predErr && predictions && predictions.length > 0) {
      for (const p of predictions as { id: string; predicted_home: number; predicted_away: number }[]) {
        const { points, breakdown } = scoreMatchPrediction({
          predictedHome: p.predicted_home,
          predictedAway: p.predicted_away,
          actualHome: body.homeScore,
          actualAway: body.awayScore,
        });
        await supabase
          .from("match_predictions")
          .update({ points_awarded: points, score_breakdown: breakdown })
          .eq("id", p.id);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
