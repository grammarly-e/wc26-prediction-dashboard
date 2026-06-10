// ============================================================================
// Scoring system for match-by-match predictions.
//
// Three-tier system — a prediction earns the single highest tier it qualifies
// for. Tiers don't stack.
//
//   Tier 3 — Exact scoreline (e.g. predicted 2-1, final 2-1)   5 pts
//   Tier 2 — Correct result AND correct goal diff               3 pts
//   Tier 1 — Correct result (W/D/L) only                        2 pts
//   Tier 0 — Wrong result                                        0 pts
//
// An exact scoreline automatically satisfies "correct goal diff" and "correct
// result", so the exact-score check must fire first to award 5 pts instead of 3.
// Max per match: 5.
// ============================================================================

import type { ScoreBreakdown } from "./types";

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

  const exactScore = predictedHome === actualHome && predictedAway === actualAway;
  const sameOutcome = outcomeOf(predictedHome, predictedAway) === outcomeOf(actualHome, actualAway);
  // Only flag goal diff as correct when outcome is also correct — a flipped
  // result with the same margin (e.g. 2-1 predicted, 1-2 actual) scores 0 pts.
  const sameGoalDiff = sameOutcome && (predictedHome - predictedAway === actualHome - actualAway);

  let points = 0;
  const breakdown: ScoreBreakdown = {
    exact_score: exactScore,
    correct_outcome: sameOutcome,
    correct_goal_difference: sameGoalDiff,
    close_approximation: false,
  };

  if (exactScore) {
    points = SCORING.EXACT_SCORE; // 5 pts
    breakdown.points_exact = points;
  } else if (sameGoalDiff) {
    points = SCORING.RESULT_AND_GOAL_DIFF; // 3 pts
    breakdown.points_goal_diff = points;
  } else if (sameOutcome) {
    points = SCORING.RESULT_ONLY; // 2 pts
    breakdown.points_outcome = points;
  }

  breakdown.total = points;
  return { points, breakdown };
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
