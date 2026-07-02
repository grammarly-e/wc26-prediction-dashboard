"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { flagForTeam } from "@/lib/flags";
import { SCORING } from "@/lib/scoring";
import { correctOutcomeRate, isKnockoutRound, RANK_MEDALS } from "@/lib/match-utils";
import type { Match, MatchPrediction } from "@/lib/types";
import type { StageLeaderboardRow } from "@/lib/predictions";

// ── Types ────────────────────────────────────────────────────────────────────

type SortMetric = "total" | "group" | "knockout" | "favourites";

export interface FavTeamSlot {
  name: string;
  pts: number;
  eliminated: boolean;
}

export interface FavRow {
  participant_id: string;
  fav_pts: number;
  detail: FavTeamSlot[];
}

interface CombinedRow extends StageLeaderboardRow {
  fav_pts: number;
  fav_detail: FavTeamSlot[];
}

interface Props {
  stageRows: StageLeaderboardRow[];
  favRows: FavRow[];
  currentParticipantId: string | null;
  breakdowns: Map<string, MatchPrediction[]>;
  matches: Map<string, Match>;
  teamNames: Map<string, string>;
}

// ── Scoring tier helpers ─────────────────────────────────────────────────────

function tierBadgeClass(points: number): string {
  if (points >= SCORING.EXACT_SCORE) return "bg-emerald-100 text-emerald-700";
  if (points >= SCORING.RESULT_AND_GOAL_DIFF) return "bg-blue-100 text-blue-700";
  if (points >= SCORING.RESULT_ONLY) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-500";
}

function getHotStreak(picks: MatchPrediction[], matches: Map<string, Match>): number {
  const scored = picks
    .filter((p) => p.points_awarded !== null)
    .map((p) => {
      const kickoffAt = matches.get(p.match_id)?.kickoff_at;
      return { pts: p.points_awarded ?? 0, kickoffMs: kickoffAt ? new Date(kickoffAt).getTime() : 0 };
    })
    .sort((a, b) => b.kickoffMs - a.kickoffMs);
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
  exact_score: "🎯 Bullseye: exact RT score (5 pts)",
  goal_diff:   "Close Call: correct RT goal margin (3 pts)",
  outcome:     "Base Win: correct RT winner, wrong margin (2 pts)",
  wrong:       "Missed: wrong RT result, or wrong advancing team on a draw (0 pts)",
  pending:     "Awaiting kickoff",
};

// ── Sort / rank helpers ───────────────────────────────────────────────────────

function getPoints(row: CombinedRow, metric: SortMetric): number {
  switch (metric) {
    case "total":      return row.group_stage_points + row.knockout_points;
    case "group":      return row.group_stage_points;
    case "knockout":   return row.knockout_points;
    case "favourites": return row.fav_pts;
  }
}

function getWdl(row: CombinedRow, metric: SortMetric): number {
  switch (metric) {
    case "total":
      return correctOutcomeRate(
        row.group_stage_correct_outcomes + row.knockout_correct_outcomes,
        row.group_stage_matches_scored + row.knockout_matches_scored
      );
    case "group":
      return correctOutcomeRate(row.group_stage_correct_outcomes, row.group_stage_matches_scored);
    case "knockout":
      return correctOutcomeRate(row.knockout_correct_outcomes, row.knockout_matches_scored);
    case "favourites":
      return 0;
  }
}

function getExact(row: CombinedRow, metric: SortMetric): number {
  switch (metric) {
    case "total":      return row.group_stage_exact_hits + row.knockout_exact_hits;
    case "group":      return row.group_stage_exact_hits;
    case "knockout":   return row.knockout_exact_hits;
    case "favourites": return 0;
  }
}

function getScoredCount(row: CombinedRow, metric: SortMetric): number {
  switch (metric) {
    case "total":      return row.group_stage_matches_scored + row.knockout_matches_scored;
    case "group":      return row.group_stage_matches_scored;
    case "knockout":   return row.knockout_matches_scored;
    case "favourites": return 0;
  }
}

function getCorrectOutcomes(row: CombinedRow, metric: SortMetric): number {
  switch (metric) {
    case "total":      return row.group_stage_correct_outcomes + row.knockout_correct_outcomes;
    case "group":      return row.group_stage_correct_outcomes;
    case "knockout":   return row.knockout_correct_outcomes;
    case "favourites": return 0;
  }
}

function sortRows(rows: CombinedRow[], metric: SortMetric): CombinedRow[] {
  return [...rows].sort((a, b) => {
    const ptsDiff = getPoints(b, metric) - getPoints(a, metric);
    if (ptsDiff !== 0) return ptsDiff;
    if (metric !== "favourites") {
      const wdlDiff = getWdl(b, metric) - getWdl(a, metric);
      if (wdlDiff !== 0) return wdlDiff;
      const exDiff = getExact(b, metric) - getExact(a, metric);
      if (exDiff !== 0) return exDiff;
    }
    return a.display_name.localeCompare(b.display_name);
  });
}

function isTied(a: CombinedRow, b: CombinedRow, metric: SortMetric): boolean {
  if (getPoints(a, metric) !== getPoints(b, metric)) return false;
  if (metric !== "favourites") {
    if (getWdl(a, metric) !== getWdl(b, metric)) return false;
    if (getExact(a, metric) !== getExact(b, metric)) return false;
  }
  return true;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CombinedLeaderboard({
  stageRows,
  favRows,
  currentParticipantId,
  breakdowns,
  matches,
  teamNames,
}: Props) {
  const [sortBy, setSortBy] = useState<SortMetric>("total");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [prevRanks, setPrevRanks] = useState<Record<string, number>>({});

  const favMap = new Map<string, FavRow>(favRows.map((r) => [r.participant_id, r]));

  const combinedRows: CombinedRow[] = stageRows.map((r) => {
    const fav = favMap.get(r.participant_id);
    return { ...r, fav_pts: fav?.fav_pts ?? 0, fav_detail: fav?.detail ?? [] };
  });

  const sortedRows = sortRows(combinedRows, sortBy);

  // Compute tie-aware display ranks.
  const displayRank: Record<string, number> = {};
  let currentRank = 1;
  for (let i = 0; i < sortedRows.length; i++) {
    if (i > 0 && !isTied(sortedRows[i - 1], sortedRows[i], sortBy)) currentRank = i + 1;
    displayRank[sortedRows[i].participant_id] = currentRank;
  }

  // Daily baseline snapshot for rank-movement arrows, keyed per sort metric.
  const storageKey = `wc2026_lb_combined_${sortBy}`;
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const current: Record<string, number> = {};
    for (const row of sortedRows) current[row.participant_id] = displayRank[row.participant_id];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw) as { date: string; baseline: Record<string, number> };
        if (stored.date === today) {
          setPrevRanks(stored.baseline);
        } else {
          localStorage.setItem(storageKey, JSON.stringify({ date: today, baseline: current }));
          setPrevRanks({});
        }
      } else {
        localStorage.setItem(storageKey, JSON.stringify({ date: today, baseline: current }));
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  const isFavs = sortBy === "favourites";
  const colSpan = isFavs ? 4 : 5;

  const SORT_LABELS: Record<SortMetric, string> = {
    total:      "Total pts",
    group:      "Group pts",
    knockout:   "KO pts",
    favourites: "Fav pts",
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Sort dropdown */}
      <div className="flex items-center gap-2.5">
        <label htmlFor="lb-sort" className="text-sm font-medium text-neutral-600">
          Sort by
        </label>
        <select
          id="lb-sort"
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value as SortMetric);
            setExpanded(null);
          }}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-pitch/30"
        >
          <option value="total">Total match points</option>
          <option value="group">Group stage points</option>
          <option value="knockout">Knockout points</option>
          <option value="favourites">Favourite team points</option>
        </select>
      </div>

      {combinedRows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">
          Nobody&rsquo;s on the board yet &mdash;{" "}
          <a href="/predictions" className="font-semibold text-pitch hover:underline">
            be the first to make your predictions
          </a>
          .
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3 font-semibold">Rank</th>
                <th className="px-4 py-3 font-semibold">Participant</th>
                {isFavs ? (
                  <>
                    <th className="px-4 py-3 font-semibold">Favourite teams</th>
                    <th className="px-4 py-3 text-right font-semibold">Fav pts</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-3 text-right font-semibold" title="Match-prediction points for the selected stage(s)">
                      {SORT_LABELS[sortBy]}
                    </th>
                    <th
                      className="px-4 py-3 text-right font-semibold"
                      title="Correct W/D/L outcome predictions out of finished matches in the selected stage(s)"
                    >
                      W/D/L %
                    </th>
                    <th className="px-4 py-3 text-right font-semibold" title="Exact scoreline predictions (5 pts each) in the selected stage(s)">
                      Exact
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const isMe = currentParticipantId === row.participant_id;
                const isOpen = expanded === row.participant_id;

                // Filter picks for the selected stage/metric.
                const allPicks = breakdowns.get(row.participant_id) ?? [];
                const stagePicks = isFavs
                  ? []
                  : allPicks.filter((p) => {
                      if (sortBy === "total") return true;
                      const m = matches.get(p.match_id);
                      if (!m) return false;
                      return sortBy === "knockout"
                        ? isKnockoutRound(m.round)
                        : !isKnockoutRound(m.round);
                    });

                const streak = isFavs ? 0 : getHotStreak(stagePicks, matches);
                const wdlPct =
                  getScoredCount(row, sortBy) > 0
                    ? Math.round((getCorrectOutcomes(row, sortBy) / getScoredCount(row, sortBy)) * 100)
                    : null;

                return (
                  <Fragment key={row.participant_id}>
                    <tr
                      className={`cursor-pointer border-b border-neutral-100 transition last:border-0 hover:bg-neutral-50 ${
                        isMe ? "bg-gold/10" : ""
                      } ${isOpen ? "bg-neutral-50" : ""}`}
                      onClick={() => setExpanded(isOpen ? null : row.participant_id)}
                      aria-expanded={isOpen}
                    >
                      {/* Rank + movement arrow */}
                      <td className="px-4 py-3 font-mono text-neutral-500">
                        <span className="inline-flex items-center gap-1.5">
                          {RANK_MEDALS[displayRank[row.participant_id]] ? (
                            <span className="text-xl leading-none">{RANK_MEDALS[displayRank[row.participant_id]]}</span>
                          ) : (
                            displayRank[row.participant_id]
                          )}
                          {(() => {
                            const prev = prevRanks[row.participant_id];
                            const cur = displayRank[row.participant_id];
                            if (prev === undefined) {
                              return Object.keys(prevRanks).length > 0 ? (
                                <span className="text-xs font-bold text-sky-500">NEW</span>
                              ) : null;
                            }
                            const delta = prev - cur;
                            if (delta === 0) return null;
                            return (
                              <span className={`text-xs font-bold ${delta > 0 ? "text-emerald-500" : "text-red-400"}`}>
                                {delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`}
                              </span>
                            );
                          })()}
                        </span>
                      </td>

                      {/* Participant name + badges */}
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
                          {streak >= 3 && (
                            <span
                              className="badge bg-orange-100 text-orange-600 text-[10px]"
                              title={`${streak} correct picks in a row`}
                            >
                              🔥{streak > 3 ? ` ${streak}` : ""}
                            </span>
                          )}
                        </span>
                      </td>

                      {/* Data columns — different layout per metric */}
                      {isFavs ? (
                        <>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {row.fav_detail.map((d) => (
                                <span
                                  key={d.name}
                                  className={`badge ${
                                    d.eliminated
                                      ? "bg-red-100 text-red-700"
                                      : d.pts >= 20
                                      ? "bg-gold/30 text-pitch"
                                      : d.pts > 0
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-neutral-100 text-neutral-500"
                                  }`}
                                >
                                  {d.name}{d.pts > 0 ? ` +${d.pts}` : ""}
                                </span>
                              ))}
                              {row.fav_detail.length === 0 && (
                                <span className="text-xs text-neutral-400">No picks</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                            {row.fav_pts}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                            {getPoints(row, sortBy)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">
                            {wdlPct !== null ? `${wdlPct}%` : <span className="text-neutral-300">--</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">
                            {getExact(row, sortBy)}
                          </td>
                        </>
                      )}
                    </tr>

                    {/* Expanded detail row */}
                    {isOpen && (
                      <tr className="border-b border-neutral-100 last:border-0">
                        <td colSpan={colSpan} className="bg-neutral-50/60 px-4 py-3">
                          {isFavs ? (
                            <FavExpandedDetail row={row} />
                          ) : (
                            <PredictionBreakdown
                              displayName={row.display_name}
                              picks={stagePicks}
                              matches={matches}
                              teamNames={teamNames}
                              sortBy={sortBy}
                              favDetail={row.fav_detail}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── FavExpandedDetail ─────────────────────────────────────────────────────────

function FavExpandedDetail({ row }: { row: CombinedRow }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {row.display_name}&rsquo;s favourite teams
      </p>
      {row.fav_detail.length === 0 ? (
        <p className="text-xs text-neutral-500">No favourite team picks recorded.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {row.fav_detail.map((d) => (
            <div
              key={d.name}
              className={`rounded-xl border px-3 py-2 text-xs ${
                d.eliminated
                  ? "border-red-200 bg-red-50"
                  : d.pts >= 20
                  ? "border-amber-300 bg-amber-50"
                  : d.pts > 0
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <span className="font-medium">{d.name}</span>
              <span className="ml-2 text-neutral-500">
                {d.eliminated
                  ? "eliminated"
                  : d.pts >= 20
                  ? "champion"
                  : d.pts > 0
                  ? `+${d.pts} pts`
                  : "in tournament"}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-500">
        Favourite team total: <span className="font-semibold">{row.fav_pts} pts</span>
      </p>
    </div>
  );
}

// ── PredictionBreakdown ───────────────────────────────────────────────────────

function PredictionBreakdown({
  displayName,
  picks,
  matches,
  teamNames,
  sortBy,
  favDetail,
}: {
  displayName: string;
  picks: MatchPrediction[];
  matches: Map<string, Match>;
  teamNames: Map<string, string>;
  sortBy: SortMetric;
  favDetail: FavTeamSlot[];
}) {
  const visible = picks
    .map((pick) => ({ pick, match: matches.get(pick.match_id) }))
    .filter((entry): entry is { pick: MatchPrediction; match: Match } => Boolean(entry.match))
    .sort((a, b) => a.match.match_number - b.match.match_number);

  const stageLabel =
    sortBy === "group" ? "group stage" : sortBy === "knockout" ? "knockout stage" : "all stage";

  return (
    <div className="flex flex-col gap-3">
      {/* Fav teams shown in total and knockout views (where fav column isn't already inline) */}
      {favDetail.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Favourite teams
          </p>
          <div className="flex flex-wrap gap-1.5">
            {favDetail.map((d) => (
              <span
                key={d.name}
                className={`badge ${
                  d.eliminated
                    ? "bg-red-100 text-red-700"
                    : d.pts > 0
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-pitch/10 text-pitch"
                }`}
              >
                {d.name}{d.pts > 0 ? ` +${d.pts}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-xs text-neutral-500">
          No {stageLabel} picks from {displayName} are visible yet &mdash; predictions only become
          visible once a match has kicked off.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-xs text-neutral-500">
              {displayName}&rsquo;s{" "}
              {sortBy !== "total" ? (sortBy === "group" ? "group stage" : "knockout") + " " : ""}
              picks ({visible.length} of {picks.length} visible):
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-500">
              {(
                [
                  ["border-emerald-400 bg-emerald-200", "Exact (5 pts)"],
                  ["border-blue-300 bg-blue-200", "Goal diff (3 pts)"],
                  ["border-yellow-300 bg-yellow-200", "W/D/L (2 pts)"],
                  ["border-red-300 bg-red-200", "Wrong"],
                ] as [string, string][]
              ).map(([cls, label]) => (
                <span key={label} className="inline-flex items-center gap-1">
                  <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full border ${cls}`} />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map(({ pick, match }) => {
              const team1 = match.team1_id ? (teamNames.get(match.team1_id) ?? match.team1_code) : match.team1_code;
              const team2 = match.team2_id ? (teamNames.get(match.team2_id) ?? match.team2_code) : match.team2_code;
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
                      {flag1 ? `${flag1} ` : ""}{team1} vs {flag2 ? `${flag2} ` : ""}{team2}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono font-semibold tabular-nums text-neutral-900">
                      {pick.predicted_home}--{pick.predicted_away}
                      {isKnockoutRound(match.round) && pick.predicted_winner_side && (
                        <span className="ml-1 font-sans text-[10px] font-normal text-neutral-400">
                          ({pick.predicted_winner_side === "team1" ? match.team1_code : match.team2_code} W)
                        </span>
                      )}
                      {hasResult && (
                        <span className="ml-1.5 text-neutral-400">
                          (final {match.home_score}--{match.away_score})
                        </span>
                      )}
                    </span>
                    {pick.points_awarded !== null && (
                      <span className={`badge ${tierBadgeClass(pick.points_awarded)}`}>
                        +{pick.points_awarded} pts
                      </span>
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
