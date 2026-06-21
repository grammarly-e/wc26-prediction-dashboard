"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { flagForTeam } from "@/lib/flags";
import { SCORING } from "@/lib/scoring";
import { isKnockoutRound } from "@/lib/match-utils";
import type { Match, MatchPrediction } from "@/lib/types";
import type { StageLeaderboardRow } from "@/lib/predictions";

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

type Stage = "group" | "knockout";

interface Props {
  /** Which independent leaderboard this table renders — group stage or knockout. */
  stage: Stage;
  rows: StageLeaderboardRow[];
  currentParticipantId: string | null;
  breakdowns: Map<string, MatchPrediction[]>;
  matches: Map<string, Match>;
  teamNames: Map<string, string>;
  /** participant_id -> [teamName1, teamName2, teamName3] */
  allFavPicks?: Map<string, string[]>;
  /**
   * When the actual top 3 is known: participant_id -> count of their
   * favourite picks that hit. Omit before the Final is played.
   */
  favouriteHits?: Record<string, number>;
}

// Green=exact(5), Blue=goal diff(3), Yellow=W/D/L(1), Red=wrong(0)
function tierBadgeClass(points: number): string {
  if (points >= SCORING.EXACT_SCORE) return "bg-emerald-100 text-emerald-700";
  if (points >= SCORING.RESULT_AND_GOAL_DIFF) return "bg-blue-100 text-blue-700";
  if (points >= SCORING.RESULT_ONLY) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-500";
}

/** Returns the length of the participant's current hot streak (consecutive scored matches with ≥1 pt). */
function getHotStreak(picks: MatchPrediction[], matches: Map<string, Match>): number {
  const scored = picks
    .filter((p) => p.points_awarded !== null)
    .map((p) => ({ pts: p.points_awarded ?? 0, num: matches.get(p.match_id)?.match_number ?? 0 }))
    .sort((a, b) => b.num - a.num);
  let streak = 0;
  for (const { pts } of scored) {
    if (pts > 0) streak++;
    else break;
  }
  return streak;
}

type PickResult = "exact_score" | "goal_diff" | "outcome" | "wrong" | "pending";

function pickResult(pick: MatchPrediction): PickResult {
  if (pick.points_awarded === null || !pick.score_breakdown) return "pending";
  if (pick.score_breakdown.exact_score) return "exact_score";
  if (pick.score_breakdown.correct_goal_difference) return "goal_diff";
  if (pick.score_breakdown.correct_outcome) return "outcome";
  return "wrong";
}

const PICK_RESULT_CLASSES: Record<PickResult, string> = {
  exact_score: "border-emerald-400 bg-emerald-50",
  goal_diff:   "border-blue-300 bg-blue-50",
  outcome:     "border-yellow-300 bg-yellow-50",
  wrong:       "border-red-300 bg-red-50",
  pending:     "border-neutral-200 bg-white",
};

const PICK_RESULT_LABELS: Record<PickResult, string> = {
  exact_score: "🎯 Perfect call — exact scoreline (5 pts)",
  goal_diff:   "Sharp eye — right result + goal margin (3 pts)",
  outcome:     "Called it — right result W/D/L (2 pts)",
  wrong:       "Missed this one (0 pts)",
  pending:     "Awaiting kickoff",
};

// Stage-aware accessors — keep the table generic over the group/knockout
// fields on StageLeaderboardRow instead of branching everywhere below.
function stagePoints(row: StageLeaderboardRow, stage: Stage): number {
  return stage === "group" ? row.group_stage_points : row.knockout_points;
}
function stageMatchesScored(row: StageLeaderboardRow, stage: Stage): number {
  return stage === "group" ? row.group_stage_matches_scored : row.knockout_matches_scored;
}
function stageExactHits(row: StageLeaderboardRow, stage: Stage): number {
  return stage === "group" ? row.group_stage_exact_hits : row.knockout_exact_hits;
}
function stageCorrectOutcomes(row: StageLeaderboardRow, stage: Stage): number {
  return stage === "group" ? row.group_stage_correct_outcomes : row.knockout_correct_outcomes;
}

export default function LeaderboardTable({ stage, rows, currentParticipantId, breakdowns, matches, teamNames, allFavPicks, favouriteHits }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [prevRanks, setPrevRanks] = useState<Record<string, number>>({});

  // Sort by this stage's points, then exact hits, then name — the same
  // tiebreak chain getStageLeaderboards() already applies server-side;
  // re-sorting here just makes the table resilient to caller ordering.
  const sortedRows = [...rows].sort((a, b) => {
    const ptsA = stagePoints(a, stage);
    const ptsB = stagePoints(b, stage);
    if (ptsB !== ptsA) return ptsB - ptsA;
    const exA = stageExactHits(a, stage);
    const exB = stageExactHits(b, stage);
    if (exB !== exA) return exB - exA;
    return a.display_name.localeCompare(b.display_name);
  });

  // Assign display ranks (ties share same rank).
  const displayRank: Record<string, number> = {};
  let currentRank = 1;
  for (let i = 0; i < sortedRows.length; i++) {
    if (i > 0) {
      const prev = sortedRows[i - 1];
      const curr = sortedRows[i];
      const tied =
        stagePoints(prev, stage) === stagePoints(curr, stage) &&
        stageExactHits(prev, stage) === stageExactHits(curr, stage);
      if (!tied) currentRank = i + 1;
    }
    displayRank[sortedRows[i].participant_id] = currentRank;
  }

  // Stage-specific storage key so the two tables on /leaderboard don't
  // clobber each other's "daily snapshot" baseline.
  const storageKey = `wc2026_lb_daily_${stage}`;

  useEffect(() => {
    // Daily delta: compare against the first snapshot taken today.
    // Use displayRank (not DB rank) so baseline and current values are on the same ranking system.
    const today = new Date().toISOString().slice(0, 10);
    const current: Record<string, number> = {};
    for (const row of rows) current[row.participant_id] = displayRank[row.participant_id];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw) as { date: string; baseline: Record<string, number> };
        if (stored.date === today) {
          setPrevRanks(stored.baseline);
        } else {
          localStorage.setItem(storageKey, JSON.stringify({ date: today, baseline: current }));
        }
      } else {
        localStorage.setItem(storageKey, JSON.stringify({ date: today, baseline: current }));
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="px-4 py-3 font-semibold">Rank</th>
            <th className="px-4 py-3 font-semibold">Participant</th>
            <th
              className="px-4 py-3 text-right font-semibold"
              title={`Match-prediction points scored in the ${stage === "group" ? "group stage" : "knockout rounds"}`}
            >
              Points
            </th>
            <th className="px-4 py-3 text-right font-semibold" title="Exact scoreline predictions (5 pts each)">Exact</th>
            <th className="px-4 py-3 text-right font-semibold" title="Correct W/D/L outcome predictions out of all finished matches in this stage">W/D/L %</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const isMe = currentParticipantId === row.participant_id;
            const isOpen = expanded === row.participant_id;
            // Only this stage's picks count toward the streak / breakdown shown when expanded.
            const picks = (breakdowns.get(row.participant_id) ?? []).filter((p) => {
              const m = matches.get(p.match_id);
              if (!m) return false;
              return stage === "knockout" ? isKnockoutRound(m.round) : !isKnockoutRound(m.round);
            });
            const favHits = favouriteHits?.[row.participant_id] ?? 0;
            const favTeams = allFavPicks?.get(row.participant_id) ?? [];
            const matchesScored = stageMatchesScored(row, stage);
            const correctOutcomes = stageCorrectOutcomes(row, stage);
            const wdlPct = matchesScored > 0 ? Math.round((correctOutcomes / matchesScored) * 100) : null;
            const streak = getHotStreak(picks, matches);
            return (
              <Fragment key={row.participant_id}>
                <tr
                  className={`cursor-pointer border-b border-neutral-100 transition last:border-0 hover:bg-neutral-50 ${isMe ? "bg-gold/10" : ""} ${isOpen ? "bg-neutral-50" : ""}`}
                  onClick={() => setExpanded(isOpen ? null : row.participant_id)}
                  aria-expanded={isOpen}
                >
                  <td className="px-4 py-3 font-mono text-neutral-500">
                    <span className="inline-flex items-center gap-1.5">
                      {MEDALS[displayRank[row.participant_id]] ?? displayRank[row.participant_id]}
                      {(() => {
                        const prev = prevRanks[row.participant_id];
                        const curRank = displayRank[row.participant_id];
                        if (prev === undefined) {
                          return Object.keys(prevRanks).length > 0 ? (
                            <span className="text-[10px] font-semibold text-sky-500">NEW</span>
                          ) : null;
                        }
                        const delta = prev - curRank;
                        if (delta === 0) return null;
                        return (
                          <span className={`text-[10px] font-semibold ${delta > 0 ? "text-emerald-500" : "text-red-400"}`}>
                            {delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
                          </span>
                        );
                      })()}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span aria-hidden="true" className="text-xs text-neutral-400">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <Link
                        href={`/participants/${row.participant_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-pitch hover:underline underline-offset-2"
                      >
                        {row.display_name}
                      </Link>
                      {isMe && <span className="badge bg-pitch text-gold">You</span>}
                      {favHits > 0 && (
                        <span className="badge bg-emerald-100 text-emerald-700 text-[10px]">
                          {favHits}/3 favs in top 3
                        </span>
                      )}
                      {streak >= 3 && (
                        <span className="badge bg-orange-100 text-orange-600 text-[10px]" title={`${streak} correct picks in a row`}>
                          🔥{streak > 3 ? ` ${streak}` : ""}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">{stagePoints(row, stage)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">{stageExactHits(row, stage)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">
                    {wdlPct !== null ? `${wdlPct}%` : <span className="text-neutral-300">--</span>}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-neutral-100 last:border-0">
                    <td colSpan={5} className="bg-neutral-50/60 px-4 py-3">
                      <PredictionBreakdown
                        displayName={row.display_name}
                        picks={picks}
                        matches={matches}
                        teamNames={teamNames}
                        favTeams={favTeams}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PredictionBreakdown({
  displayName,
  picks,
  matches,
  teamNames,
  favTeams,
}: {
  displayName: string;
  picks: MatchPrediction[];
  matches: Map<string, Match>;
  teamNames: Map<string, string>;
  favTeams?: string[];
}) {
  const visible = picks
    .map((pick) => ({ pick, match: matches.get(pick.match_id) }))
    .filter((entry): entry is { pick: MatchPrediction; match: Match } => Boolean(entry.match))
    .sort((a, b) => a.match.match_number - b.match.match_number);

  return (
    <div className="flex flex-col gap-3">
      {favTeams && favTeams.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Favourite teams
          </p>
          <div className="flex flex-wrap gap-2">
            {favTeams.map((name) => (
              <span key={name} className="badge bg-pitch/10 text-pitch">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-xs text-neutral-500">
          No picks from {displayName} are visible yet &mdash; others&rsquo; predictions for a match only become
          visible once that match has kicked off.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-xs text-neutral-500">
              {displayName}&rsquo;s picks for matches that have been scored ({visible.length} of {picks.length} total):
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-emerald-400 bg-emerald-200" />
                Exact score (5 pts)
              </span>
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-blue-300 bg-blue-200" />
                Goal diff (3 pts)
              </span>
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-yellow-300 bg-yellow-200" />
                W/D/L (2 pts)
              </span>
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-red-300 bg-red-200" />
                Wrong
              </span>
            </div>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map(({ pick, match }) => {
              const team1 = match.team1_id ? teamNames.get(match.team1_id) ?? match.team1_code : match.team1_code;
              const team2 = match.team2_id ? teamNames.get(match.team2_id) ?? match.team2_code : match.team2_code;
              const flag1 = flagForTeam(team1);
              const flag2 = flagForTeam(team2);
              const hasResult = match.home_score !== null && match.away_score !== null;
              const result = pickResult(pick);
              return (
                <div
                  key={pick.id}
                  title={PICK_RESULT_LABELS[result]}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs shadow-sm ${PICK_RESULT_CLASSES[result]}`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-neutral-500">
                      #{match.match_number} &middot; {match.round}
                    </span>
                    <span className="truncate font-medium text-neutral-700">
                      {flag1 ? `${flag1} ` : ""}
                      {team1} vs {flag2 ? `${flag2} ` : ""}
                      {team2}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono font-semibold tabular-nums text-neutral-900">
                      {pick.predicted_home}--{pick.predicted_away}
                      {hasResult && (
                        <span className="ml-1.5 text-neutral-400">
                          (final {match.home_score}--{match.away_score})
                        </span>
                      )}
                    </span>
                    {pick.points_awarded !== null && (
                      <span className={`badge ${tierBadgeClass(pick.points_awarded)}`}>+{pick.points_awarded} pts</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
