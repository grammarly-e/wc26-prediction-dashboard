// ============================================================================
// Scoring system for match-by-match predictions.
//
// Three-tier system — a prediction earns the single highest tier it qualifies
// for. Tiers don't stack.
//
//   Tier 3 — Exact scoreline (e.g. predicted 2-1, final 2-1)   5 pts
//   Tier 2 — Correct result AND correct goal diff               3 pts
//   Tier 1 — Correct result (W/D/L, or winner pick) only        2 pts
//   Tier 0 — Wrong result                                        0 pts
//
// An exact scoreline automatically satisfies "correct goal diff" and "correct
// result", so the exact-score check must fire first to award 5 pts instead of 3.
// Max per match: 5.
//
// Knockout matches (supabase/migrations/0012_knockout_winner_predictions.sql):
// a draw isn't a valid final outcome — the match always produces a winner,
// possibly via penalties. So for knockout matches, participants make an
// explicit winner pick (predictedWinnerSide) alongside their scoreline, and
// Tier 1 is derived from that pick (predictedWinnerSide === actualWinnerSide)
// instead of from the scoreline's W/D/L direction. Tiers 3 and 2 stay
// scoreline-only and unchanged — matches.home_score/away_score already store
// the 90min+extra-time result with shootout goals stripped out (see
// regulationAndExtraTimeScore() in providers/football-data.ts), so a 1-1
// prediction against a 1-1 90+ET draw (settled on penalties) still correctly
// scores on the scoreline tiers regardless of who won the shootout.
// ============================================================================

import type { ScoreBreakdown, WinnerSide } from "./types";

export const SCORING = {
  EXACT_SCORE: 5,
  RESULT_AND_GOAL_DIFF: 3,
  RESULT_ONLY: 2,
} as const;

export type Outcome = "home_win" | "draw" | "away_win";

export function outcomeOf(home: number, away: number): Outcome {
  if (home > away) return "home_win";
  if (home < away) return "away_win";
  return "draw";
}

export interface MatchScoreInput {
  predictedHome: number;
  predictedAway: number;
  actualHome: number;
  actualAway: number;
  /** Set for knockout-round matches — switches Tier 1 to winner-pick scoring. */
  isKnockout?: boolean;
  predictedWinnerSide?: WinnerSide | null;
  actualWinnerSide?: WinnerSide | null;
}

export interface MatchScoreResult {
  points: number;
  breakdown: ScoreBreakdown;
}

/**
 * Score a single match prediction against the final result.
 * Pure function — safe to unit test and to reuse both server-side (the sync
 * job, once a match finishes) and client-side (a "what would I have scored"
 * preview while the match is live).
 */
export function scoreMatchPrediction(input: MatchScoreInput): MatchScoreResult {
  const { predictedHome, predictedAway, actualHome, actualAway, isKnockout, predictedWinnerSide, actualWinnerSide } = input;

  const exactScore = predictedHome === actualHome && predictedAway === actualAway;
  const sameOutcome = outcomeOf(predictedHome, predictedAway) === outcomeOf(actualHome, actualAway);
  // Only flag goal diff as correct when outcome is also correct — a flipped
  // result with the same margin (e.g. 2-1 predicted, 1-2 actual) scores 0 pts.
  // Scoreline-only and intentionally unaffected by isKnockout/winner pick —
  // see module header.
  const sameGoalDiff = sameOutcome && (predictedHome - predictedAway === actualHome - actualAway);

  // Tier 1: knockout matches use the explicit winner pick (no draw possible
  // in the final outcome); group stage keeps the scoreline-derived W/D/L.
  const correctOutcome = isKnockout
    ? predictedWinnerSide != null && predictedWinnerSide === actualWinnerSide
    : sameOutcome;

  let points = 0;
  const breakdown: ScoreBreakdown = {
    exact_score: exactScore,
    correct_outcome: correctOutcome,
    correct_goal_difference: sameGoalDiff,
    close_approximation: false,
  };

  if (exactScore) {
    points = SCORING.EXACT_SCORE; // 5 pts
    breakdown.points_exact = points;
  } else if (sameGoalDiff) {
    points = SCORING.RESULT_AND_GOAL_DIFF; // 3 pts
    breakdown.points_goal_diff = points;
  } else if (correctOutcome) {
    points = SCORING.RESULT_ONLY; // 2 pts
    breakdown.points_outcome = points;
  }

  breakdown.total = points;
  return { points, breakdown };
}

/** Maps the football-data.org winner field to our positional team1/team2 slot.
 *  team1 is always the provider's homeTeam, team2 always awayTeam (see
 *  syncMatches() in sync.ts) — so HOME_TEAM/AWAY_TEAM map directly across. */
export function winnerSideFromProvider(winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null): WinnerSide | null {
  if (winner === "HOME_TEAM") return "team1";
  if (winner === "AWAY_TEAM") return "team2";
  return null;
}

// ============================================================================
// Tournament-long predictions (champion, golden boot, group winners, etc.)
// These are simple hit-or-miss: the participant either named the right
// team/player or didn't. Point values live in `prediction_categories.points_value`
// so you can rebalance them without touching code.
// ============================================================================

export interface TournamentScoreInput {
  predictedTeamId?: string | null;
  predictedPlayerId?: string | null;
  predictedPlayerName?: string | null;
  actualTeamId?: string | null;
  actualPlayerId?: string | null;
  actualPlayerName?: string | null;
  pointsValue: number;
}

export function scoreTournamentPrediction(input: TournamentScoreInput): number {
  const {
    predictedTeamId,
    predictedPlayerId,
    predictedPlayerName,
    actualTeamId,
    actualPlayerId,
    actualPlayerName,
    pointsValue,
  } = input;

  if (predictedTeamId && actualTeamId) {
    return predictedTeamId === actualTeamId ? pointsValue : 0;
  }

  if (predictedPlayerId && actualPlayerId) {
    return predictedPlayerId === actualPlayerId ? pointsValue : 0;
  }

  // Fallback to name comparison when a player isn't matched to a roster row
  // (useful early in the tournament before squads are finalized in our DB).
  if (predictedPlayerName && actualPlayerName) {
    return predictedPlayerName.trim().toLowerCase() === actualPlayerName.trim().toLowerCase()
      ? pointsValue
      : 0;
  }

  return 0;
}
