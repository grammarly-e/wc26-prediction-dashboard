// ============================================================================
// Scoring system for match-by-match predictions.
//
// This is a TIERED system: a prediction earns the single highest tier it
// qualifies for (tiers don't stack), plus one small additive "close call"
// bonus for near-misses that don't qualify for any tier. This keeps the
// incentives clean — there's no situation where guessing wildly accurate
// totals beats genuinely reading the match correctly.
//
//   Tier 1 — Exact scoreline                         25 pts
//   Tier 2 — Correct result AND correct goal diff    15 pts
//   Tier 3 — Correct result (W/D/L) only              8 pts
//   Tier 0 — Wrong result                             0 pts
//   Bonus  — "Close call": wrong result, but both     3 pts
//            scorelines are within 1 goal each way
//            (e.g. predicted 1-1, actual 2-1)
//
// Max per match: 25. A perfect group stage (72 matches) would be 1,800 pts
// from match predictions alone — tournament-long picks (below) add more on
// top, so the race stays open through the knockout rounds.
// ============================================================================

import type { ScoreBreakdown } from "./types";

export const SCORING = {
  EXACT_SCORE: 25,
  RESULT_AND_GOAL_DIFF: 15,
  RESULT_ONLY: 8,
  CLOSE_CALL_BONUS: 3,
  CLOSE_CALL_MARGIN: 1, // each scoreline within ±1 goal of actual
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
  const { predictedHome, predictedAway, actualHome, actualAway } = input;

  const exact = predictedHome === actualHome && predictedAway === actualAway;
  const sameOutcome = outcomeOf(predictedHome, predictedAway) === outcomeOf(actualHome, actualAway);
  const sameGoalDiff = predictedHome - predictedAway === actualHome - actualAway;

  const closeCall =
    Math.abs(predictedHome - actualHome) <= SCORING.CLOSE_CALL_MARGIN &&
    Math.abs(predictedAway - actualAway) <= SCORING.CLOSE_CALL_MARGIN;

  let points = 0;
  const breakdown: ScoreBreakdown = {
    exact_score: exact,
    correct_outcome: sameOutcome,
    correct_goal_difference: sameGoalDiff,
    close_approximation: false,
  };

  if (exact) {
    points = SCORING.EXACT_SCORE;
    breakdown.points_exact = points;
  } else if (sameOutcome && sameGoalDiff) {
    points = SCORING.RESULT_AND_GOAL_DIFF;
    breakdown.points_goal_diff = points;
  } else if (sameOutcome) {
    points = SCORING.RESULT_ONLY;
    breakdown.points_outcome = points;
  } else if (closeCall) {
    points = SCORING.CLOSE_CALL_BONUS;
    breakdown.close_approximation = true;
    breakdown.points_approximation = points;
  }

  breakdown.total = points;
  return { points, breakdown };
}

// ============================================================================
// Tournament-long predictions (champion, golden boot, group winners, etc.)
// These are simple hit-or-miss: the participant either named the right
// team/player or didn't. Point values live in `prediction_categories.points_value`
// so you can rebalance them (e.g. make "Champion" worth more than "3rd
// place finisher") without touching code — see supabase/seed/categories.sql.
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
