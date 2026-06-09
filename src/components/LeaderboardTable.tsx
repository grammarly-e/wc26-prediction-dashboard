"use client";

// ============================================================================
// The leaderboard table — click a participant's name to expand their
// match-by-match prediction breakdown in place.
//
// The breakdown data is computed server-side (getVisibleMatchPredictionsByParticipant
// in src/lib/predictions.ts) and handed down whole, because RLS already did
// the hard part: each viewer only ever receives picks they're allowed to see
// (their own, any time; everyone else's only for matches that have kicked
// off — supabase/migrations/0002_row_level_security.sql). So expanding a row
// here never needs another round trip, and never risks showing a pick early.
// ============================================================================

import { Fragment, useEffect, useState } from "react";
import { flagForTeam } from "@/lib/flags";
import { SCORING } from "@/lib/scoring";
import type { Match, MatchPrediction } from "@/lib/types";

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export interface LeaderboardTableRow {
  participant_id: string;
  display_name: string;
  rank: number;
  total_points: number;
  match_points: number;
  tournament_points: number;
  exact_score_hits: number;
  group_stage_points: number;
  knockout_points: number;
}

interface Props {
  rows: LeaderboardTableRow[];
  currentParticipantId: string | null;
  breakdowns: Map<string, MatchPrediction[]>;
  matches: Map<string, Match>;
  teamNames: Map<string, string>;
}

function tierBadgeClass(points: number): string {
  if (points >= SCORING.EXACT_SCORE) return "bg-gold/30 text-pitch";
  if (points >= SCORING.RESULT_AND_GOAL_DIFF) return "bg-emerald-100 text-emerald-700";
  if (points >= SCORING.RESULT_ONLY) return "bg-sky-100 text-sky-700";
  if (points > 0) return "bg-neutral-200 text-neutral-600";
  return "bg-neutral-100 text-neutral-400";
}

// ----------------------------------------------------------------------------
// Right/wrong/exact color coding for the breakdown cards — gold for an exact
// scoreline, green for a correct W/D/L call (even if the scoreline was off),
// red for a wrong call (including the small "close call" bonus, since the
// outcome itself was still a miss), neutral for picks not yet scored (the
// match hasn't finished, so score_breakdown/points_awarded are still null).
// ----------------------------------------------------------------------------
type PickResult = "exact" | "correct" | "wrong" | "pending";

function pickResult(pick: MatchPrediction): PickResult {
  if (pick.points_awarded === null || !pick.score_breakdown) return "pending";
  if (pick.score_breakdown.exact_score) return "exact";
  if (pick.score_breakdown.correct_outcome) return "correct";
  return "wrong";
}

const PICK_RESULT_CLASSES: Record<PickResult, string> = {
  exact: "border-gold/50 bg-gold/10",
  correct: "border-emerald-300 bg-emerald-50",
  wrong: "border-red-200 bg-red-50",
  pending: "border-neutral-200 bg-white",
};

const PICK_RESULT_LABELS: Record<PickResult, string> = {
  exact: "Exact scoreline",
  correct: "Right result",
  wrong: "Wrong call",
  pending: "Awaiting kickoff",
};

export default function LeaderboardTable({ rows, currentParticipantId, breakdowns, matches, teamNames }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  // Track rank movement since the last page load via localStorage.
  // On mount: read the ranks from the previous visit (for the delta display),
  // then immediately write current ranks so the *next* load has a baseline.
  const [prevRanks, setPrevRanks] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const stored = localStorage.getItem("wc2026_leaderboard_ranks");
      if (stored) setPrevRanks(JSON.parse(stored) as Record<string, number>);
    } catch {
      // localStorage unavailable or stale JSON — silently ignore
    }
    const current: Record<string, number> = {};
    for (const row of rows) current[row.participant_id] = row.rank;
    try {
      localStorage.setItem("wc2026_leaderboard_ranks", JSON.stringify(current));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="px-4 py-3 font-semibold">Rank</th>
            <th className="px-4 py-3 font-semibold">Participant</th>
            <th className="px-4 py-3 text-right font-semibold">Total</th>
            <th className="px-4 py-3 text-right font-semibold" title="Match-prediction points scored in the group stage">
              Group
            </th>
            <th className="px-4 py-3 text-right font-semibold" title="Match-prediction points scored in the knockout rounds">
              Knockout
            </th>
            <th className="px-4 py-3 text-right font-semibold">Exact calls</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isMe = currentParticipantId === row.participant_id;
            const isOpen = expanded === row.participant_id;
            const picks = breakdowns.get(row.participant_id) ?? [];
            return (
              <Fragment key={row.participant_id}>
                <tr
                  className={`cursor-pointer border-b border-neutral-100 transition last:border-0 hover:bg-neutral-50 ${
                    isMe ? "bg-gold/10" : ""
                  } ${isOpen ? "bg-neutral-50" : ""}`}
                  onClick={() => setExpanded(isOpen ? null : row.participant_id)}
                  aria-expanded={isOpen}
                >
                  <td className="px-4 py-3 font-mono text-neutral-500">
                    <span className="inline-flex items-center gap-1.5">
                      {MEDALS[row.rank] ?? row.rank}
                      {(() => {
                        const prev = prevRanks[row.participant_id];
                        if (prev === undefined) {
                          // New entrant — only show "NEW" if we have a baseline from last visit
                          return Object.keys(prevRanks).length > 0 ? (
                            <span className="text-[10px] font-semibold text-sky-500">NEW</span>
                          ) : null;
                        }
                        const delta = prev - row.rank; // positive = moved up
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
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="text-xs text-neutral-400">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      {row.display_name}
                      {isMe && <span className="badge bg-pitch text-gold">You</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">{row.total_points}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">{row.group_stage_points}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">{row.knockout_points}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">{row.exact_score_hits}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-neutral-100 last:border-0">
                    <td colSpan={6} className="bg-neutral-50/60 px-4 py-3">
                      <PredictionBreakdown
                        displayName={row.display_name}
                        picks={picks}
                        matches={matches}
                        teamNames={teamNames}
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
}: {
  displayName: string;
  picks: MatchPrediction[];
  matches: Map<string, Match>;
  teamNames: Map<string, string>;
}) {
  const visible = picks
    .map((pick) => ({ pick, match: matches.get(pick.match_id) }))
    .filter((entry): entry is { pick: MatchPrediction; match: Match } => Boolean(entry.match))
    .sort((a, b) => a.match.match_number - b.match.match_number);

  if (visible.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No picks from {displayName} are visible yet — others&rsquo; predictions for a match only become visible once
        that match has kicked off.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-neutral-500">
          {displayName}&rsquo;s picks for matches that have kicked off so far ({visible.length} of {picks.length} total):
        </p>
        <div className="flex items-center gap-3 text-[11px] text-neutral-500">
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-gold/50 bg-gold/30" />
            Exact
          </span>
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-emerald-300 bg-emerald-200" />
            Right result
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
                  #{match.match_number} · {match.round}
                </span>
                <span className="truncate font-medium text-neutral-700">
                  {flag1 ? `${flag1} ` : ""}
                  {team1} vs {flag2 ? `${flag2} ` : ""}
                  {team2}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono font-semibold tabular-nums text-neutral-900">
                  {pick.predicted_home}–{pick.predicted_away}
                  {hasResult && (
                    <span className="ml-1.5 text-neutral-400">
                      (final {match.home_score}–{match.away_score})
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
  );
}
