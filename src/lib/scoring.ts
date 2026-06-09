// ============================================================================
// Scoring system for match-by-match predictions.
//
// Two-tier system — a prediction earns the single highest tier it qualifies
// for. Tiers don't stack.
//
//   Tier 2 — Correct result AND correct goal diff     3 pts
//   Tier 1 — Correct result (W/D/L) only              1 pt
//   Tier 0 — Wrong result                             0 pts
//
// Note: an exact scoreline automatically satisfies "correct goal diff", so
// a perfect prediction (e.g. predicted 2-1, final 2-1) scores 3 pts.
// Max per match: 3.
// ============================================================================

import type { ScoreBreakdown } from "./types";

export const SCORING = {
  RESULT_AND_GOAL_DIFF: 3,
  RESULT_ONLY: 1,
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

  const sameOutcome = outcomeOf(predictedHome, predictedAway) === outcomeOf(actualHome, actualAway);
  const sameGoalDiff = predictedHome - predictedAway === actualHome - actualAway;
  // exact_score is retained in the breakdown for informational purposes only
  const exactScore = predictedHome === actualHome && predictedAway === actualAway;

  let points = 0;
  const breakdown: ScoreBreakdown = {
    exact_score: exactScore,
    correct_outcome: sameOutcome,
    // Only flag goal diff as correct when the outcome is also correct — a
    // flipped result with the same margin (e.g. 2-1 predicted, 1-2 actual)
    // is a wrong call and scores 0 pts.
    correct_goal_difference: sameOutcome && sameGoalDiff,
    close_approximation: false,
  };

  if (sameOutcome && sameGoalDiff) {
    points = SCORING.RESULT_AND_GOAL_DIFF; // 3 pts
    breakdown.points_goal_diff = points;
  } else if (sameOutcome) {
    points = SCORING.RESULT_ONLY; // 1 pt
    breakdown.points_outcome = points;
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
