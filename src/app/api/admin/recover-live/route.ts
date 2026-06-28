import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { adminTokenHash } from "@/lib/admin-auth";
import { scoreMatchPrediction } from "@/lib/scoring";
import { recomputeStandingsAndBracket } from "@/lib/admin-recompute";
import { isKnockoutRound } from "@/lib/match-utils";
import type { Database, MatchRound, WinnerSide } from "@/lib/types";

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

const STALE_LIVE_THRESHOLD_HOURS = 3.5;

export async function POST() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
  }
  const supabase = createClient<Database>(url, key);

  const cutoff = new Date(Date.now() - STALE_LIVE_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("matches")
    .select("id, match_number, external_id, status, kickoff_at, home_score, away_score, round, winner_side")
    .eq("status", "live")
    .lt("kickoff_at", cutoff);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stale = (data ?? []) as Array<{
    id: string;
    match_number: number;
    external_id: string | null;
    status: string;
    kickoff_at: string;
    home_score: number | null;
    away_score: number | null;
    round: MatchRound;
    winner_side: WinnerSide | null;
  }>;

  const results: Array<{ matchNumber: number; outcome: string }> = [];

  for (const m of stale) {
    if (m.home_score === null || m.away_score === null) {
      results.push({ matchNumber: m.match_number, outcome: "skipped — no score in DB" });
      continue;
    }

    const { error: fixErr } = await supabase
      .from("matches")
      .update({ status: "finished", updated_at: new Date().toISOString() })
      .eq("id", m.id);

    if (fixErr) {
      results.push({ matchNumber: m.match_number, outcome: `error: ${fixErr.message}` });
      continue;
    }

    // Score all predictions for this match now that it's finished.
    const { data: preds } = await supabase
      .from("match_predictions")
      .select("id, predicted_home, predicted_away, predicted_winner_side")
      .eq("match_id", m.id);

    if (preds?.length) {
      const actualHome = m.home_score;
      const actualAway = m.away_score;
      const isKnockout = isKnockoutRound(m.round);
      const actualWinnerSide = m.winner_side;
      // Batched: independent per-prediction writes, no need to serialize.
      await Promise.all(
        (preds as { id: string; predicted_home: number; predicted_away: number; predicted_winner_side: WinnerSide | null }[]).map(
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

    results.push({
      matchNumber: m.match_number,
      outcome: `recovered (${m.home_score}-${m.away_score}), ${preds?.length ?? 0} predictions scored`,
    });
  }

  // Standings/bracket are computed entirely from our own matches table (no
  // external call) -- so whenever this route flips a match to "finished",
  // recompute immediately rather than waiting for a later sync pass. Mirrors
  // the same call in update-match and override-match-teams.
  let recomputeError: string | null = null;
  if (stale.length > 0) {
    try {
      await recomputeStandingsAndBracket(supabase);
    } catch (err) {
      recomputeError = err instanceof Error ? err.message : String(err);
      console.error("[recover-live] recompute failed:", recomputeError);
    }
  }

  return NextResponse.json({
    ok: true,
    staleFound: stale.length,
    results,
    ...(recomputeError ? { recomputeError } : {}),
  });
}
