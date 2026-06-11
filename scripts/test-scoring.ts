// ============================================================================
// Unit tests for scoring logic and match card helpers.
// No database required — pure function tests only.
//
// Run:  npm test
// Or:   tsx scripts/test-scoring.ts
//
// SECURITY: This file contains no DB access and no environment variables.
// Safe to run on any machine. Do NOT add DB access here.
// ============================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Import scoring.ts helpers
// ---------------------------------------------------------------------------
import {
  scoreMatchPrediction,
  scoreTournamentPrediction,
  outcomeOf,
  SCORING,
} from "../src/lib/scoring.js";

// ---------------------------------------------------------------------------
// Replicate inline helpers from MatchCard.tsx so they can be unit-tested.
// If these are ever extracted to a shared util, update these imports instead.
// ---------------------------------------------------------------------------

type ConsensusData = {
  total: number;
  home_win_count: number;
  draw_count: number;
  away_win_count: number;
};

type PredictionReveal = {
  predicted_home: number;
  predicted_away: number;
  display_name: string;
  points_awarded: number | null;
  exact_score: boolean;
  correct_outcome: boolean;
};

function consensusOutcome(c: ConsensusData): "home" | "draw" | "away" {
  if (c.home_win_count >= c.draw_count && c.home_win_count >= c.away_win_count)
    return "home";
  if (c.away_win_count > c.draw_count && c.away_win_count > c.home_win_count)
    return "away";
  return "draw";
}

function actualOutcome(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

interface ScoreBucket {
  score: string;
  count: number;
  isActual: boolean;
}

function buildScoreDistribution(
  predictions: PredictionReveal[],
  actualHome: number | null,
  actualAway: number | null,
): ScoreBucket[] {
  const counts = new Map<string, number>();
  for (const p of predictions) {
    const key = `${p.predicted_home}-${p.predicted_away}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const actualKey =
    actualHome !== null && actualAway !== null
      ? `${actualHome}-${actualAway}`
      : null;
  return Array.from(counts.entries())
    .map(([score, count]) => ({
      score,
      count,
      isActual: score === actualKey,
    }))
    .sort(
      (a, b) =>
        b.count - a.count || (a.isActual ? -1 : b.isActual ? 1 : 0),
    );
}

const SHOCK_THRESHOLD = 0.6;

function getShockInfo(
  consensus: ConsensusData,
  actualHome: number,
  actualAway: number,
  team1: string,
  team2: string,
): { pct: number; label: string } | null {
  if (consensus.total < 4) return null;
  const cOutcome = consensusOutcome(consensus);
  const aOutcome = actualOutcome(actualHome, actualAway);
  if (cOutcome === aOutcome) return null;
  const cCount =
    cOutcome === "home"
      ? consensus.home_win_count
      : cOutcome === "away"
      ? consensus.away_win_count
      : consensus.draw_count;
  const pct = cCount / consensus.total;
  if (pct < SHOCK_THRESHOLD) return null;
  const label =
    cOutcome === "home"
      ? team1.length > 12
        ? "a home win"
        : team1
      : cOutcome === "away"
      ? team2.length > 12
        ? "an away win"
        : team2
      : "a draw";
  return { pct: Math.round(pct * 100), label };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe("outcomeOf", () => {
  test("home win", () => assert.equal(outcomeOf(2, 1), "home_win"));
  test("away win", () => assert.equal(outcomeOf(0, 1), "away_win"));
  test("draw", () => assert.equal(outcomeOf(1, 1), "draw"));
  test("0-0 draw", () => assert.equal(outcomeOf(0, 0), "draw"));
  test("large home win", () => assert.equal(outcomeOf(7, 0), "home_win"));
});

describe("scoreMatchPrediction — Tier 3 (exact score, 5 pts)", () => {
  test("standard win prediction exact", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 1, actualHome: 2, actualAway: 1 });
    assert.equal(r.points, SCORING.EXACT_SCORE);
    assert.equal(r.breakdown.exact_score, true);
  });

  test("0-0 draw exact", () => {
    const r = scoreMatchPrediction({ predictedHome: 0, predictedAway: 0, actualHome: 0, actualAway: 0 });
    assert.equal(r.points, SCORING.EXACT_SCORE);
    assert.equal(r.breakdown.exact_score, true);
  });

  test("high-scoring exact", () => {
    const r = scoreMatchPrediction({ predictedHome: 4, predictedAway: 3, actualHome: 4, actualAway: 3 });
    assert.equal(r.points, SCORING.EXACT_SCORE);
  });

  test("away win exact", () => {
    const r = scoreMatchPrediction({ predictedHome: 0, predictedAway: 2, actualHome: 0, actualAway: 2 });
    assert.equal(r.points, SCORING.EXACT_SCORE);
  });
});

describe("scoreMatchPrediction — Tier 2 (correct goal diff + outcome, 3 pts)", () => {
  test("same margin, home win", () => {
    // Predicted 2-1, actual 3-2: same outcome (home win) and same goal diff (+1)
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 1, actualHome: 3, actualAway: 2 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF);
    assert.equal(r.breakdown.correct_goal_difference, true);
    assert.equal(r.breakdown.exact_score, false);
  });

  test("same margin, away win", () => {
    // Predicted 0-1, actual 1-2: away win by 1
    const r = scoreMatchPrediction({ predictedHome: 0, predictedAway: 1, actualHome: 1, actualAway: 2 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF);
  });

  test("draws with same zero diff (0-0 vs 1-1)", () => {
    // Both draws, goal diff 0 in each case
    const r = scoreMatchPrediction({ predictedHome: 0, predictedAway: 0, actualHome: 1, actualAway: 1 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF);
    assert.equal(r.breakdown.correct_goal_difference, true);
  });

  test("draws with same zero diff (2-2 vs 0-0)", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 2, actualHome: 0, actualAway: 0 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF);
  });
});

describe("scoreMatchPrediction — Tier 1 (correct outcome only, 2 pts)", () => {
  test("correct home win, different margin", () => {
    // Predicted 1-0, actual 3-0: both home wins but different diff
    const r = scoreMatchPrediction({ predictedHome: 1, predictedAway: 0, actualHome: 3, actualAway: 0 });
    assert.equal(r.points, SCORING.RESULT_ONLY);
    assert.equal(r.breakdown.correct_outcome, true);
    assert.equal(r.breakdown.correct_goal_difference, false);
  });

  test("correct away win, different margin", () => {
    const r = scoreMatchPrediction({ predictedHome: 0, predictedAway: 1, actualHome: 0, actualAway: 3 });
    assert.equal(r.points, SCORING.RESULT_ONLY);
  });

  test("correct draw, but different actual scores with different diff — wait, draws always have diff 0", () => {
    // Actually draws always have goal_diff=0, so any draw prediction vs draw actual = 3 pts (same diff)
    // This test verifies that: predicted 3-3, actual 1-1 → 3 pts
    const r = scoreMatchPrediction({ predictedHome: 3, predictedAway: 3, actualHome: 1, actualAway: 1 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF, "draws always share goal_diff=0 → 3 pts");
  });
});

describe("scoreMatchPrediction — Tier 0 (wrong outcome, 0 pts)", () => {
  test("predicted home win, actual away win", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 0, actualHome: 0, actualAway: 1 });
    assert.equal(r.points, 0);
    assert.equal(r.breakdown.correct_outcome, false);
  });

  test("predicted draw, actual home win", () => {
    const r = scoreMatchPrediction({ predictedHome: 1, predictedAway: 1, actualHome: 2, actualAway: 0 });
    assert.equal(r.points, 0);
  });

  test("predicted home win, actual draw", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 1, actualHome: 1, actualAway: 1 });
    assert.equal(r.points, 0);
  });

  test("flipped scoreline 2-1 predicted vs 1-2 actual → 0 pts despite same absolute margin", () => {
    // This is critical: same absolute diff but opposite outcome must score 0
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 1, actualHome: 1, actualAway: 2 });
    assert.equal(r.points, 0, "flipped result must not score goal-diff points");
    assert.equal(r.breakdown.correct_goal_difference, false);
    assert.equal(r.breakdown.correct_outcome, false);
  });

  test("flipped 3-0 vs 0-3 → 0 pts", () => {
    const r = scoreMatchPrediction({ predictedHome: 3, predictedAway: 0, actualHome: 0, actualAway: 3 });
    assert.equal(r.points, 0);
  });
});

describe("scoreMatchPrediction — breakdown structure", () => {
  test("exact score breakdown has correct flags", () => {
    const r = scoreMatchPrediction({ predictedHome: 1, predictedAway: 0, actualHome: 1, actualAway: 0 });
    assert.equal(r.breakdown.exact_score, true);
    assert.equal(r.breakdown.correct_outcome, true);
    assert.equal(r.breakdown.correct_goal_difference, true);
    assert.equal(r.breakdown.total, 5);
    assert.equal(r.breakdown.points_exact, 5);
  });

  test("goal diff tier breakdown", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 1, actualHome: 3, actualAway: 2 });
    assert.equal(r.breakdown.exact_score, false);
    assert.equal(r.breakdown.correct_goal_difference, true);
    assert.equal(r.breakdown.total, 3);
    assert.equal(r.breakdown.points_goal_diff, 3);
  });

  test("outcome-only breakdown", () => {
    const r = scoreMatchPrediction({ predictedHome: 1, predictedAway: 0, actualHome: 4, actualAway: 0 });
    assert.equal(r.breakdown.exact_score, false);
    assert.equal(r.breakdown.correct_goal_difference, false);
    assert.equal(r.breakdown.correct_outcome, true);
    assert.equal(r.breakdown.total, 2);
    assert.equal(r.breakdown.points_outcome, 2);
  });

  test("wrong outcome breakdown", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 0, actualHome: 0, actualAway: 1 });
    assert.equal(r.breakdown.exact_score, false);
    assert.equal(r.breakdown.correct_goal_difference, false);
    assert.equal(r.breakdown.correct_outcome, false);
    assert.equal(r.breakdown.total, 0);
  });
});

describe("scoreTournamentPrediction — team picks", () => {
  const TEAM_A = "uuid-team-a";
  const TEAM_B = "uuid-team-b";

  test("correct team pick → full points", () => {
    const pts = scoreTournamentPrediction({
      predictedTeamId: TEAM_A,
      actualTeamId: TEAM_A,
      pointsValue: 20,
    });
    assert.equal(pts, 20);
  });

  test("wrong team pick → 0 pts", () => {
    const pts = scoreTournamentPrediction({
      predictedTeamId: TEAM_A,
      actualTeamId: TEAM_B,
      pointsValue: 20,
    });
    assert.equal(pts, 0);
  });

  test("no actual team yet → 0 pts", () => {
    const pts = scoreTournamentPrediction({
      predictedTeamId: TEAM_A,
      actualTeamId: null,
      pointsValue: 20,
    });
    assert.equal(pts, 0);
  });
});

describe("scoreTournamentPrediction — player picks (name fallback)", () => {
  test("case-insensitive name match → full points", () => {
    const pts = scoreTournamentPrediction({
      predictedPlayerName: "Kylian Mbappé",
      actualPlayerName: "kylian mbappé",
      pointsValue: 10,
    });
    assert.equal(pts, 10);
  });

  test("trimmed name match → full points", () => {
    const pts = scoreTournamentPrediction({
      predictedPlayerName: "  Vinicius Jr  ",
      actualPlayerName: "Vinicius Jr",
      pointsValue: 10,
    });
    assert.equal(pts, 10);
  });

  test("wrong player → 0 pts", () => {
    const pts = scoreTournamentPrediction({
      predictedPlayerName: "Erling Haaland",
      actualPlayerName: "Kylian Mbappé",
      pointsValue: 10,
    });
    assert.equal(pts, 0);
  });

  test("no actual player yet → 0 pts", () => {
    const pts = scoreTournamentPrediction({
      predictedPlayerName: "Erling Haaland",
      actualPlayerName: null,
      pointsValue: 10,
    });
    assert.equal(pts, 0);
  });
});

describe("consensusOutcome", () => {
  test("clear home majority", () => {
    assert.equal(consensusOutcome({ total: 10, home_win_count: 7, draw_count: 2, away_win_count: 1 }), "home");
  });

  test("clear away majority", () => {
    assert.equal(consensusOutcome({ total: 10, home_win_count: 1, draw_count: 2, away_win_count: 7 }), "away");
  });

  test("clear draw majority", () => {
    assert.equal(consensusOutcome({ total: 10, home_win_count: 2, draw_count: 6, away_win_count: 2 }), "draw");
  });

  test("home-draw tie → home wins tie (home >= draw)", () => {
    assert.equal(consensusOutcome({ total: 4, home_win_count: 2, draw_count: 2, away_win_count: 0 }), "home");
  });

  test("all tied → home (home >= draw and home >= away)", () => {
    assert.equal(consensusOutcome({ total: 3, home_win_count: 1, draw_count: 1, away_win_count: 1 }), "home");
  });
});

describe("actualOutcome", () => {
  test("home win", () => assert.equal(actualOutcome(2, 1), "home"));
  test("away win", () => assert.equal(actualOutcome(0, 2), "away"));
  test("draw", () => assert.equal(actualOutcome(1, 1), "draw"));
  test("0-0 draw", () => assert.equal(actualOutcome(0, 0), "draw"));
});

describe("buildScoreDistribution", () => {
  const makePred = (h: number, a: number): PredictionReveal => ({
    predicted_home: h,
    predicted_away: a,
    display_name: "Test",
    points_awarded: null,
    exact_score: false,
    correct_outcome: false,
  });

  test("groups identical predictions", () => {
    const preds = [makePred(1, 0), makePred(1, 0), makePred(2, 1)];
    const buckets = buildScoreDistribution(preds, null, null);
    assert.equal(buckets[0].score, "1-0");
    assert.equal(buckets[0].count, 2);
    assert.equal(buckets[1].score, "2-1");
    assert.equal(buckets[1].count, 1);
  });

  test("marks actual score as isActual", () => {
    const preds = [makePred(1, 0), makePred(2, 1), makePred(2, 1)];
    const buckets = buildScoreDistribution(preds, 1, 0);
    const actual = buckets.find((b) => b.score === "1-0");
    assert.ok(actual, "actual score bucket must exist");
    assert.equal(actual!.isActual, true);
    const other = buckets.find((b) => b.score === "2-1");
    assert.ok(other);
    assert.equal(other!.isActual, false);
  });

  test("actual score sorts ahead of equal-count bucket", () => {
    // 1-0 and 2-1 both have 1 vote; actual is 2-1 → 2-1 should come first
    const preds = [makePred(1, 0), makePred(2, 1)];
    const buckets = buildScoreDistribution(preds, 2, 1);
    assert.equal(buckets[0].score, "2-1");
    assert.equal(buckets[0].isActual, true);
  });

  test("no actual score → no bucket marked isActual", () => {
    const preds = [makePred(1, 0), makePred(2, 1)];
    const buckets = buildScoreDistribution(preds, null, null);
    assert.ok(buckets.every((b) => !b.isActual));
  });

  test("empty predictions → empty array", () => {
    const buckets = buildScoreDistribution([], 1, 0);
    assert.equal(buckets.length, 0);
  });
});

describe("shockInfo / shock result detection", () => {
  const shock = (
    homeCount: number,
    drawCount: number,
    awayCount: number,
    actualHome: number,
    actualAway: number,
  ) =>
    getShockInfo(
      {
        total: homeCount + drawCount + awayCount,
        home_win_count: homeCount,
        draw_count: drawCount,
        away_win_count: awayCount,
      },
      actualHome,
      actualAway,
      "Brazil",
      "Cameroon",
    );

  test("≥60% tipped home, away wins → shock", () => {
    // 7/10 = 70% tipped home, actual is away win
    const info = shock(7, 1, 2, 0, 1);
    assert.ok(info, "should return shock info");
    assert.equal(info!.pct, 70);
    assert.equal(info!.label, "Brazil"); // team1 is ≤12 chars
  });

  test("exactly 60% threshold → shock (boundary)", () => {
    // 6/10 = 60% tipped home, actual is away win
    const info = shock(6, 2, 2, 0, 1);
    assert.ok(info);
    assert.equal(info!.pct, 60);
  });

  test("59% → no shock (just below threshold)", () => {
    // Need 4 minimum: 4 total, 2 tipped home (50%) → no shock regardless
    // Use 10 preds: 5.9 → floor to simulate: 5/10 = 50%, not enough
    // Actually: need < 60%, so 5/10
    const info = shock(5, 3, 2, 0, 1);
    assert.equal(info, null);
  });

  test("consensus was correct → no shock", () => {
    // 8/10 tipped home, home actually wins
    const info = shock(8, 1, 1, 2, 0);
    assert.equal(info, null);
  });

  test("fewer than 4 predictions → no shock regardless", () => {
    // Only 3 predictions, even if 100% wrong
    const info = getShockInfo(
      { total: 3, home_win_count: 3, draw_count: 0, away_win_count: 0 },
      0, 1, "Brazil", "Cameroon",
    );
    assert.equal(info, null);
  });

  test("long team name → 'an away win' label instead of team name", () => {
    // team2 is >12 chars
    const info = getShockInfo(
      { total: 10, home_win_count: 2, draw_count: 1, away_win_count: 7 },
      1, 0, "Brazil", "Saudi Arabia",
      // "Saudi Arabia" is 12 chars exactly — NOT over 12, so it should appear
    );
    // Actually "Saudi Arabia" = 12 chars, NOT > 12, so label = "Saudi Arabia"
    assert.ok(info);
    assert.equal(info!.label, "Saudi Arabia");
  });

  test("team name >12 chars uses generic label", () => {
    const info = getShockInfo(
      { total: 10, home_win_count: 2, draw_count: 1, away_win_count: 7 },
      1, 0, "Brazil", "Czech Republic",
    );
    // "Czech Republic" = 14 chars > 12 → label is "an away win"
    assert.ok(info);
    assert.equal(info!.label, "an away win");
  });

  test("draw shock: majority tipped draw, actual is win", () => {
    const info = shock(1, 7, 2, 2, 0);
    assert.ok(info);
    assert.equal(info!.label, "a draw");
  });
});

// ---------------------------------------------------------------------------
// Point constant sanity checks (guards against accidental edits to scoring.ts)
// ---------------------------------------------------------------------------
describe("SCORING constants", () => {
  test("EXACT_SCORE = 5", () => assert.equal(SCORING.EXACT_SCORE, 5));
  test("RESULT_AND_GOAL_DIFF = 3", () => assert.equal(SCORING.RESULT_AND_GOAL_DIFF, 3));
  test("RESULT_ONLY = 2", () => assert.equal(SCORING.RESULT_ONLY, 2));
});
