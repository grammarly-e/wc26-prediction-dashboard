// ============================================================================
// Shared match list helpers — round ordering, grouping, filtering, and
// display sorting. Pure functions only (no I/O), so this module is safe to
// import from both server components and "use client" components.
//
// Extracted from duplicated copies that previously lived independently in
// page.tsx, predictions/page.tsx, participants/[id]/page.tsx, and
// AdminDashboard.tsx — keep all four in sync by editing only this file.
// ============================================================================

import type { Match, MatchRound } from "./types";

/**
 * Top-3 rank → medal emoji, shared by every page that renders a ranked list
 * (leaderboard table, favourites leaderboard, participant page, scorers
 * page). Was previously redefined independently in four places — keep all
 * four in sync by editing only this constant.
 */
export const RANK_MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export const ROUND_ORDER: MatchRound[] = [
  "Group Stage",
  "Round of 32",
  "Round of 16",
  "Quarter-final",
  "Semi-final",
  "Match for third place",
  "Final",
];

/**
 * Same rounds as ROUND_ORDER, but with the knockout stage listed first.
 * Once the group stage concludes, group-stage results are historical
 * reference while the knockout stage is the live, relevant content -- so
 * the public-facing pages (schedule, predictions, leaderboard, standings)
 * lead with it. ROUND_ORDER itself stays chronological, since other logic
 * (groupByRound's Map seeding, admin data entry order) still wants
 * tournament order rather than display order.
 */
export const DISPLAY_ROUND_ORDER: MatchRound[] = [
  "Round of 32",
  "Round of 16",
  "Quarter-final",
  "Semi-final",
  "Match for third place",
  "Final",
  "Group Stage",
];

/**
 * Single source of truth for the group/knockout split used by the two
 * independent stage leaderboards (see getStageLeaderboards() in
 * predictions.ts and LeaderboardTable.tsx). Everything that isn't the
 * Group Stage counts as knockout.
 */
export function isKnockoutRound(round: MatchRound): boolean {
  return round !== "Group Stage";
}

/**
 * Correct-outcome (W/D/L) rate as a 0-1 fraction. This is the first
 * tiebreaker on the stage leaderboards — ranked ahead of exact-score hits —
 * see getStageLeaderboards() in predictions.ts and the sort/rank logic in
 * LeaderboardTable.tsx. Participants with no scored matches in the stage
 * get 0 rather than NaN, so they sort below anyone with a positive rate.
 */
export function correctOutcomeRate(correctOutcomes: number, matchesScored: number): number {
  return matchesScored > 0 ? correctOutcomes / matchesScored : 0;
}

/**
 * Group matches by round, pre-seeding every round (even empty ones) in
 * tournament order so callers can iterate ROUND_ORDER and skip empties.
 */
export function groupByRound(matches: Match[]): Map<MatchRound, Match[]> {
  const grouped = new Map<MatchRound, Match[]>();
  for (const round of ROUND_ORDER) grouped.set(round, []);
  for (const m of matches) {
    const list = grouped.get(m.round) ?? [];
    list.push(m);
    grouped.set(m.round, list);
  }
  return grouped;
}

/**
 * Filter matches by group/knockout selector and a team-name search string.
 * `teamNames` resolves team1_id/team2_id to display names (falls back to the
 * raw team code when a team isn't confirmed yet).
 */
export function filterMatches(
  matches: Match[],
  group: string | null,
  search: string,
  teamNames: Map<string, string>
): Match[] {
  return matches.filter((m) => {
    if (group) {
      if (group === "knockout") {
        if (m.round === "Group Stage") return false;
      } else {
        if (m.group_letter !== group.toUpperCase()) return false;
      }
    }
    if (search) {
      const q = search.toLowerCase();
      const t1 = (m.team1_id ? teamNames.get(m.team1_id) ?? m.team1_code : m.team1_code).toLowerCase();
      const t2 = (m.team2_id ? teamNames.get(m.team2_id) ?? m.team2_code : m.team2_code).toLowerCase();
      if (!t1.includes(q) && !t2.includes(q)) return false;
    }
    return true;
  });
}

// Lower sorts first: live matches need eyes on them, then scheduled
// (upcoming), then postponed, with finished matches pushed to the bottom.
export const STATUS_SORT_ORDER: Record<string, number> = {
  live: 0,
  scheduled: 1,
  postponed: 2,
  finished: 3,
};

/**
 * Sort matches for display: incomplete matches (live/scheduled/postponed)
 * before finished ones, ties broken by kickoff time. Does not mutate the
 * input array.
 */
export function sortMatchesForDisplay(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    const sa = STATUS_SORT_ORDER[a.status] ?? 99;
    const sb = STATUS_SORT_ORDER[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime();
  });
}

/**
 * Has this match's kickoff passed? The single gating check for "is it safe
 * to reveal someone else's pick for this match" (see
 * getVisibleMatchPredictionsByParticipant() and getParticipantMatchPredictions()
 * in predictions.ts, used by the leaderboard breakdown and the participant
 * prediction-sheet page) as well as "is the prediction form for this match
 * locked" (see MatchPredictionCard.tsx). Deliberately keyed off kickoff_at
 * rather than match.status === "scheduled" -- status is written by the sync
 * job and can lag a few minutes behind the actual kickoff clock, whereas
 * comparing the timestamp directly matches the bar the DB's RLS policy
 * (supabase/migrations/0002_*) actually enforces for locking picks.
 */
export function hasKickedOff(match: Match): boolean {
  return new Date(match.kickoff_at).getTime() <= Date.now();
}
