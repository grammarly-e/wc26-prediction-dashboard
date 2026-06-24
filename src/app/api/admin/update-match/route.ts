import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { scoreMatchPrediction } from "@/lib/scoring";
import { recomputeStandingsAndBracket } from "@/lib/admin-recompute";
import { isKnockoutRound } from "@/lib/match-utils";
import type { MatchRound, MatchStatus, WinnerSide } from "@/lib/types";

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
    round: MatchRound;
    winnerSide: WinnerSide | null;
  };

  const supabase = createServiceRoleClient();
  const isKnockout = isKnockoutRound(body.round);

  // 1. Update the match record.
  const { error } = await supabase
    .from("matches")
    .update({
      home_score: body.homeScore,
      away_score: body.awayScore,
      status: body.status,
      winner_side: body.winnerSide,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.matchId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 2. Whenever both scores are present, score predictions and recompute
  //    standings immediately -- regardless of status. computeStandings only
  //    counts "finished" matches, but triggering on score entry means the
  //    admin does not have to worry about status order.
  if (body.homeScore != null && body.awayScore != null) {
    const { data: predictions, error: predErr } = await supabase
      .from("match_predictions")
      .select("id, predicted_home, predicted_away, predicted_winner_side")
      .eq("match_id", body.matchId);

    if (!predErr && predictions && predictions.length > 0) {
      const actualHome = body.homeScore;
      const actualAway = body.awayScore;
      const actualWinnerSide = body.winnerSide;
      // Batched: independent per-prediction writes, no need to serialize.
      await Promise.all(
        (predictions as { id: string; predicted_home: number; predicted_away: number; predicted_winner_side: WinnerSide | null }[]).map(
          async (p) => {
            const { points, breakdown } = scoreMatchPrediction({
              predictedHome: p.predicted_home,
              predictedAway: p.predicted_away,
              actualHome,
              actualAway,
              isKnockout,
              predictedWinnerSide: p.predicted_winner_side,
              actualWinnerSide,
            });
            await supabase
              .from("match_predictions")
              .update({ points_awarded: points, score_breakdown: breakdown })
              .eq("id", p.id);
          }
        )
      );
    }

    // Await recompute so standings are updated before the client refreshes.
    // Surface errors in the response body so admin can see if recompute failed.
    let recomputeError: string | null = null;
    try {
      await recomputeStandingsAndBracket(supabase);
    } catch (err) {
      recomputeError = err instanceof Error ? err.message : String(err);
      console.error("[update-match] recompute failed:", recomputeError);
    }

    if (recomputeError) {
      return NextResponse.json({ ok: true, recomputeError }, { status: 200 });
    }
  }

  return NextResponse.json({ ok: true });
}
