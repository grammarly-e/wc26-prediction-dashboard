// ============================================================================
// Unit tests for scoring logic and match card helpers.
// No database, no build step, no dependencies beyond Node.js.
//
// Run:  node scripts/test-scoring.mjs
//       npm test
//
// SECURITY: Pure logic tests only — no DB access, no env vars loaded.
// ============================================================================

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Inline the pure functions from src/lib/scoring.ts
// (If the TS source changes, update here too.)
// ---------------------------------------------------------------------------

const SCORING = Object.freeze({
  EXACT_SCORE: 5,
  RESULT_AND_GOAL_DIFF: 3,
  RESULT_ONLY: 2,
});

function outcomeOf(home, away) {
  if (home > away) return "home_win";
  if (home < away) return "away_win";
  return "draw";
}

function scoreMatchPrediction({ predictedHome, predictedAway, actualHome, actualAway }) {
  const exactScore = predictedHome === actualHome && predictedAway === actualAway;
  const sameOutcome =
    outcomeOf(predictedHome, predictedAway) === outcomeOf(actualHome, actualAway);
  const sameGoalDiff =
    sameOutcome && predictedHome - predictedAway === actualHome - actualAway;

  let points = 0;
  const breakdown = {
    exact_score: exactScore,
    correct_outcome: sameOutcome,
    correct_goal_difference: sameGoalDiff,
    close_approximation: false,
  };

  if (exactScore) {
    points = SCORING.EXACT_SCORE;
    breakdown.points_exact = points;
  } else if (sameGoalDiff) {
    points = SCORING.RESULT_AND_GOAL_DIFF;
    breakdown.points_goal_diff = points;
  } else if (sameOutcome) {
    points = SCORING.RESULT_ONLY;
    breakdown.points_outcome = points;
  }

  breakdown.total = points;
  return { points, breakdown };
}

function scoreTournamentPrediction({
  predictedTeamId,
  predictedPlayerId,
  predictedPlayerName,
  actualTeamId,
  actualPlayerId,
  actualPlayerName,
  pointsValue,
}) {
  if (predictedTeamId && actualTeamId)
    return predictedTeamId === actualTeamId ? pointsValue : 0;
  if (predictedPlayerId && actualPlayerId)
    return predictedPlayerId === actualPlayerId ? pointsValue : 0;
  if (predictedPlayerName && actualPlayerName)
    return predictedPlayerName.trim().toLowerCase() ===
      actualPlayerName.trim().toLowerCase()
      ? pointsValue
      : 0;
  return 0;
}

// ---------------------------------------------------------------------------
// Inline helpers from MatchCard.tsx
// ---------------------------------------------------------------------------

function consensusOutcome({ home_win_count, draw_count, away_win_count }) {
  if (home_win_count >= draw_count && home_win_count >= away_win_count) return "home";
  if (away_win_count > draw_count && away_win_count > home_win_count) return "away";
  return "draw";
}

function actualOutcome(home, away) {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

function buildScoreDistribution(predictions, actualHome, actualAway) {
  const counts = new Map();
  for (const p of predictions) {
    const key = `${p.predicted_home}-${p.predicted_away}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const actualKey =
    actualHome !== null && actualAway !== null ? `${actualHome}-${actualAway}` : null;
  return Array.from(counts.entries())
    .map(([score, count]) => ({ score, count, isActual: score === actualKey }))
    .sort((a, b) => b.count - a.count || (a.isActual ? -1 : b.isActual ? 1 : 0));
}

const SHOCK_THRESHOLD = 0.6;

function getShockInfo(consensus, actualHome, actualAway, team1, team2) {
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
      ? team1.length > 12 ? "a home win" : team1
      : cOutcome === "away"
      ? team2.length > 12 ? "an away win" : team2
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
  test("standard win exact", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 1, actualHome: 2, actualAway: 1 });
    assert.equal(r.points, SCORING.EXACT_SCORE);
    assert.equal(r.breakdown.exact_score, true);
  });
  test("0-0 draw exact", () => {
    const r = scoreMatchPrediction({ predictedHome: 0, predictedAway: 0, actualHome: 0, actualAway: 0 });
    assert.equal(r.points, SCORING.EXACT_SCORE);
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
  test("same +1 margin, home win (2-1 vs 3-2)", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 1, actualHome: 3, actualAway: 2 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF);
    assert.equal(r.breakdown.correct_goal_difference, true);
    assert.equal(r.breakdown.exact_score, false);
  });
  test("same +1 margin, away win (0-1 vs 1-2)", () => {
    const r = scoreMatchPrediction({ predictedHome: 0, predictedAway: 1, actualHome: 1, actualAway: 2 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF);
  });
  test("both draws → same zero diff (0-0 vs 1-1)", () => {
    const r = scoreMatchPrediction({ predictedHome: 0, predictedAway: 0, actualHome: 1, actualAway: 1 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF);
    assert.equal(r.breakdown.correct_goal_difference, true);
  });
  test("both draws (2-2 vs 0-0)", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 2, actualHome: 0, actualAway: 0 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF);
  });
  test("3-3 vs 1-1 → 3 pts", () => {
    const r = scoreMatchPrediction({ predictedHome: 3, predictedAway: 3, actualHome: 1, actualAway: 1 });
    assert.equal(r.points, SCORING.RESULT_AND_GOAL_DIFF);
  });
});

describe("scoreMatchPrediction — Tier 1 (correct outcome only, 2 pts)", () => {
  test("correct home win, different margin (1-0 vs 3-0)", () => {
    const r = scoreMatchPrediction({ predictedHome: 1, predictedAway: 0, actualHome: 3, actualAway: 0 });
    assert.equal(r.points, SCORING.RESULT_ONLY);
    assert.equal(r.breakdown.correct_outcome, true);
    assert.equal(r.breakdown.correct_goal_difference, false);
  });
  test("correct away win, different margin (0-1 vs 0-3)", () => {
    const r = scoreMatchPrediction({ predictedHome: 0, predictedAway: 1, actualHome: 0, actualAway: 3 });
    assert.equal(r.points, SCORING.RESULT_ONLY);
  });
  test("correct home win, different larger margin (1-0 vs 4-1)", () => {
    const r = scoreMatchPrediction({ predictedHome: 1, predictedAway: 0, actualHome: 4, actualAway: 1 });
    assert.equal(r.points, SCORING.RESULT_ONLY);
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
  test("CRITICAL: flipped 2-1 vs 1-2 → 0 pts (same margin, opposite result)", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 1, actualHome: 1, actualAway: 2 });
    assert.equal(r.points, 0, "flipped result must not earn goal-diff points");
    assert.equal(r.breakdown.correct_goal_difference, false);
    assert.equal(r.breakdown.correct_outcome, false);
  });
  test("CRITICAL: flipped 3-0 vs 0-3 → 0 pts", () => {
    const r = scoreMatchPrediction({ predictedHome: 3, predictedAway: 0, actualHome: 0, actualAway: 3 });
    assert.equal(r.points, 0);
  });
});

describe("scoreMatchPrediction — breakdown structure integrity", () => {
  test("exact score: all flags true, total = 5", () => {
    const r = scoreMatchPrediction({ predictedHome: 1, predictedAway: 0, actualHome: 1, actualAway: 0 });
    assert.equal(r.breakdown.exact_score, true);
    assert.equal(r.breakdown.correct_outcome, true);
    assert.equal(r.breakdown.correct_goal_difference, true);
    assert.equal(r.breakdown.total, 5);
    assert.equal(r.breakdown.points_exact, 5);
  });
  test("goal diff tier: exact=false, goal_diff=true, total=3", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 1, actualHome: 3, actualAway: 2 });
    assert.equal(r.breakdown.exact_score, false);
    assert.equal(r.breakdown.correct_goal_difference, true);
    assert.equal(r.breakdown.total, 3);
    assert.equal(r.breakdown.points_goal_diff, 3);
  });
  test("outcome-only: exact=false, goal_diff=false, outcome=true, total=2", () => {
    const r = scoreMatchPrediction({ predictedHome: 1, predictedAway: 0, actualHome: 4, actualAway: 0 });
    assert.equal(r.breakdown.exact_score, false);
    assert.equal(r.breakdown.correct_goal_difference, false);
    assert.equal(r.breakdown.correct_outcome, true);
    assert.equal(r.breakdown.total, 2);
    assert.equal(r.breakdown.points_outcome, 2);
  });
  test("wrong: all false, total=0", () => {
    const r = scoreMatchPrediction({ predictedHome: 2, predictedAway: 0, actualHome: 0, actualAway: 1 });
    assert.equal(r.breakdown.exact_score, false);
    assert.equal(r.breakdown.correct_goal_difference, false);
    assert.equal(r.breakdown.correct_outcome, false);
    assert.equal(r.breakdown.total, 0);
  });
});

describe("scoreTournamentPrediction — team picks", () => {
  const A = "uuid-team-a", B = "uuid-team-b";
  test("correct team → full points", () =>
    assert.equal(scoreTournamentPrediction({ predictedTeamId: A, actualTeamId: A, pointsValue: 20 }), 20));
  test("wrong team → 0 pts", () =>
    assert.equal(scoreTournamentPrediction({ predictedTeamId: A, actualTeamId: B, pointsValue: 20 }), 0));
  test("no actual yet → 0 pts", () =>
    assert.equal(scoreTournamentPrediction({ predictedTeamId: A, actualTeamId: null, pointsValue: 20 }), 0));
  test("champion points = 20", () =>
    assert.equal(scoreTournamentPrediction({ predictedTeamId: A, actualTeamId: A, pointsValue: 20 }), 20));
  test("runner-up points = 10", () =>
    assert.equal(scoreTournamentPrediction({ predictedTeamId: A, actualTeamId: A, pointsValue: 10 }), 10));
});

describe("scoreTournamentPrediction — player picks (name fallback)", () => {
  test("case-insensitive match → full points", () =>
    assert.equal(
      scoreTournamentPrediction({ predictedPlayerName: "Kylian Mbappé", actualPlayerName: "kylian mbappé", pointsValue: 10 }),
      10,
    ));
  test("whitespace trimmed → match", () =>
    assert.equal(
      scoreTournamentPrediction({ predictedPlayerName: "  Vinicius Jr  ", actualPlayerName: "Vinicius Jr", pointsValue: 10 }),
      10,
    ));
  test("wrong player → 0", () =>
    assert.equal(
      scoreTournamentPrediction({ predictedPlayerName: "Erling Haaland", actualPlayerName: "Kylian Mbappé", pointsValue: 10 }),
      0,
    ));
  test("no actual player yet → 0", () =>
    assert.equal(
      scoreTournamentPrediction({ predictedPlayerName: "Erling Haaland", actualPlayerName: null, pointsValue: 10 }),
      0,
    ));
});

describe("consensusOutcome", () => {
  test("clear home majority",
    () => assert.equal(consensusOutcome({ total: 10, home_win_count: 7, draw_count: 2, away_win_count: 1 }), "home"));
  test("clear away majority",
    () => assert.equal(consensusOutcome({ total: 10, home_win_count: 1, draw_count: 2, away_win_count: 7 }), "away"));
  test("clear draw majority",
    () => assert.equal(consensusOutcome({ total: 10, home_win_count: 2, draw_count: 6, away_win_count: 2 }), "draw"));
  test("home-draw tie → home (home >= draw)",
    () => assert.equal(consensusOutcome({ total: 4, home_win_count: 2, draw_count: 2, away_win_count: 0 }), "home"));
  test("three-way tie → home (home >= all)",
    () => assert.equal(consensusOutcome({ total: 3, home_win_count: 1, draw_count: 1, away_win_count: 1 }), "home"));
});

describe("actualOutcome", () => {
  test("home win", () => assert.equal(actualOutcome(2, 1), "home"));
  test("away win", () => assert.equal(actualOutcome(0, 2), "away"));
  test("draw", () => assert.equal(actualOutcome(1, 1), "draw"));
  test("0-0 draw", () => assert.equal(actualOutcome(0, 0), "draw"));
});

describe("buildScoreDistribution", () => {
  const p = (h, a) => ({ predicted_home: h, predicted_away: a });

  test("groups identical predictions", () => {
    const b = buildScoreDistribution([p(1, 0), p(1, 0), p(2, 1)], null, null);
    assert.equal(b[0].score, "1-0");
    assert.equal(b[0].count, 2);
    assert.equal(b[1].score, "2-1");
    assert.equal(b[1].count, 1);
  });

  test("marks actual score as isActual", () => {
    const b = buildScoreDistribution([p(1, 0), p(2, 1), p(2, 1)], 1, 0);
    const actual = b.find((x) => x.score === "1-0");
    assert.ok(actual);
    assert.equal(actual.isActual, true);
    assert.equal(b.find((x) => x.score === "2-1").isActual, false);
  });

  test("actual score sorts ahead of equal-count bucket", () => {
    // 1-0 and 2-1 each have 1 vote; actual=2-1 should come first
    const b = buildScoreDistribution([p(1, 0), p(2, 1)], 2, 1);
    assert.equal(b[0].score, "2-1");
    assert.equal(b[0].isActual, true);
  });

  test("null actual → no bucket isActual", () => {
    const b = buildScoreDistribution([p(1, 0), p(2, 1)], null, null);
    assert.ok(b.every((x) => !x.isActual));
  });

  test("empty predictions → empty array", () => {
    assert.equal(buildScoreDistribution([], 1, 0).length, 0);
  });

  test("single unique score", () => {
    const b = buildScoreDistribution([p(0, 0)], 0, 0);
    assert.equal(b.length, 1);
    assert.equal(b[0].isActual, true);
    assert.equal(b[0].count, 1);
  });
});

describe("shockInfo / shock result detection", () => {
  const mk = (h, d, a) => ({ total: h + d + a, home_win_count: h, draw_count: d, away_win_count: a });

  test("70% tipped home, away wins → shock", () => {
    const info = getShockInfo(mk(7, 1, 2), 0, 1, "Brazil", "Cameroon");
    assert.ok(info);
    assert.equal(info.pct, 70);
    assert.equal(info.label, "Brazil");         // ≤12 chars → team name
  });

  test("exactly 60% threshold → shock (boundary)", () => {
    const info = getShockInfo(mk(6, 2, 2), 0, 1, "Brazil", "Cameroon");
    assert.ok(info);
    assert.equal(info.pct, 60);
  });

  test("50% tipped home, away wins → no shock (below threshold)", () => {
    const info = getShockInfo(mk(5, 3, 2), 0, 1, "Brazil", "Cameroon");
    assert.equal(info, null);
  });

  test("consensus was correct → no shock", () => {
    const info = getShockInfo(mk(8, 1, 1), 2, 0, "Brazil", "Cameroon");
    assert.equal(info, null);
  });

  test("< 4 predictions → no shock regardless of pct", () => {
    const info = getShockInfo(mk(3, 0, 0), 0, 1, "Brazil", "Cameroon");
    assert.equal(info, null);
  });

  test("exactly 4 predictions, 75% wrong → shock", () => {
    const info = getShockInfo(mk(3, 0, 1), 0, 1, "Brazil", "Cameroon");
    assert.ok(info);
    assert.equal(info.pct, 75);
  });

  test("away shock: 70% tipped away, home wins", () => {
    const info = getShockInfo(mk(1, 2, 7), 2, 0, "Brazil", "Cameroon");
    assert.ok(info);
    assert.equal(info.pct, 70);
    assert.equal(info.label, "Cameroon");
  });

  test("draw shock: 70% tipped draw, home wins", () => {
    const info = getShockInfo(mk(1, 7, 2), 2, 0, "Brazil", "Cameroon");
    assert.ok(info);
    assert.equal(info.label, "a draw");
  });

  test("team name >12 chars uses generic label", () => {
    const info = getShockInfo(mk(7, 1, 2), 0, 1, "Czech Republic", "Cameroon");
    // "Czech Republic" = 14 chars > 12 → "a home win"
    assert.ok(info);
    assert.equal(info.label, "a home win");
  });

  test("team name = 12 chars uses team name (not >12)", () => {
    // "Saudi Arabia" = 12 chars, not > 12 → show team name
    const info = getShockInfo(mk(2, 1, 7), 1, 0, "Brazil", "Saudi Arabia");
    assert.ok(info);
    assert.equal(info.label, "Saudi Arabia");
  });
});

describe("SCORING constants sanity check", () => {
  test("EXACT_SCORE = 5", () => assert.equal(SCORING.EXACT_SCORE, 5));
  test("RESULT_AND_GOAL_DIFF = 3", () => assert.equal(SCORING.RESULT_AND_GOAL_DIFF, 3));
  test("RESULT_ONLY = 2", () => assert.equal(SCORING.RESULT_ONLY, 2));
});
