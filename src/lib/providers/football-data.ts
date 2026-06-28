// ============================================================================
// Thin client for football-data.org v4 — our live-data provider.
//
// Why this provider: its free tier explicitly includes the FIFA World Cup
// (competition code "WC") at 10 requests/minute, which is enough for a
// scheduled sync running every few minutes. Docs: https://docs.football-data.org
//
// Known free-tier limits to design around:
//   - Scores can be slightly delayed (not sub-second live).
//   - No detailed player statistics on the free tier — that's why the sync
//     job treats top-scorer/lineup data as "best effort" and the schema
//     keeps `player_name` as a fallback column wherever a player_id can't
//     be resolved yet.
// If you upgrade to a paid tier (or add a second provider like API-Football
// for richer player data), this is the only file that needs to change —
// everything downstream consumes the normalized shapes below.
// ============================================================================

import type { MatchRound } from "../types";

const BASE_URL = "https://api.football-data.org/v4";
const COMPETITION_CODE = "WC"; // FIFA World Cup

function authHeaders(): HeadersInit {
  const token = process.env.FOOTBALL_DATA_API_KEY;
  if (!token) {
    throw new Error("FOOTBALL_DATA_API_KEY is not set — see .env.local.example");
  }
  return { "X-Auth-Token": token };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: authHeaders(),
    // Always hit the network — this runs in scheduled jobs / route handlers,
    // never in a cached render path.
    cache: "no-store",
  });

  if (res.status === 429) {
    throw new Error("football-data.org rate limit hit (free tier: 10 req/min) — back off and retry.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ---- Normalized shapes our sync job works with ----

export interface ProviderMatch {
  id: number;
  utcDate: string;
  status: "SCHEDULED" | "TIMED" | "IN_PLAY" | "PAUSED" | "FINISHED" | "POSTPONED" | "SUSPENDED" | "CANCELLED";
  matchday: number | null;
  stage: string; // e.g. "GROUP_STAGE", "LAST_16", "QUARTER_FINALS", "FINAL"
  group: string | null; // e.g. "Group A"
  homeTeam: { id: number; name: string; shortName: string | null; tla: string | null };
  awayTeam: { id: number; name: string; shortName: string | null; tla: string | null };
  score: {
    winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
    // Defaults to REGULAR; EXTRA_TIME/PENALTY_SHOOTOUT only show up on
    // knockout fixtures that needed extra periods. See overtime.html docs:
    // https://docs.football-data.org/general/v4/overtime.html
    duration: "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT";
    // "Running total" score — for EXTRA_TIME matches this already includes
    // the extra-time goals on top of the 90-minute score; for
    // PENALTY_SHOOTOUT matches it includes the shootout goals on top of
    // that (e.g. a 1-1 draw decided 6-5 on penalties after a 2-2 ET comes
    // back as fullTime 8-7). Use regulationScore() below to strip both back
    // out and get the 90-minutes-+-stoppage-time score we store and score
    // predictions against.
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
    regularTime?: { home: number | null; away: number | null };
    extraTime?: { home: number | null; away: number | null };
    // Only the goals scored within the shootout itself — appears once
    // duration is PENALTY_SHOOTOUT.
    penalties?: { home: number | null; away: number | null };
  };
}

/**
 * The score at the 90-minutes-+-stoppage-time mark only — deliberately
 * excluding both extra-time and penalty-shootout goals. Predictions are
 * scored against this number for every match, knockout included, so a
 * prediction of e.g. 1-1 still registers as the exact scoreline it
 * predicted even when the match went on to 2-1 in extra time or was settled
 * on penalties. winner_side (who actually advances) is derived separately
 * from score.winner and is unaffected by this — it still reflects the true
 * result including extra time and penalties, since that's what decides
 * bracket advancement and the knockout "who wins" prediction pick.
 *
 * REGULAR duration: fullTime already is the 90+stoppage score.
 * EXTRA_TIME / PENALTY_SHOOTOUT: prefer the provider's own regularTime
 * field (the score it recorded at the 90-minute mark). If the provider
 * omits regularTime (seen intermittently on the free tier), fall back to
 * subtracting penalties only — better than nothing, but note this fallback
 * can still include extra-time goals since there's no way to separate them
 * from fullTime without regularTime or extraTime present.
 */
export function regulationScore(
  score: ProviderMatch["score"]
): { home: number | null; away: number | null } {
  if (score.duration === "REGULAR") {
    return score.fullTime;
  }

  if (
    score.regularTime &&
    score.regularTime.home !== null &&
    score.regularTime.away !== null
  ) {
    return score.regularTime;
  }

  console.warn(
    "[regulationScore] provider omitted regularTime for a non-REGULAR-duration match — " +
      "falling back to fullTime minus penalties only, which may still include extra-time goals."
  );

  if (score.duration !== "PENALTY_SHOOTOUT" || !score.penalties) {
    return score.fullTime;
  }
  const { home: ftHome, away: ftAway } = score.fullTime;
  const { home: penHome, away: penAway } = score.penalties;
  return {
    home: ftHome !== null ? ftHome - (penHome ?? 0) : null,
    away: ftAway !== null ? ftAway - (penAway ?? 0) : null,
  };
}

export interface ProviderStandingTableRow {
  position: number;
  team: { id: number; name: string };
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface ProviderStandingsGroup {
  group: string | null; // "GROUP_A" etc, null for overall/knockout tables
  table: ProviderStandingTableRow[];
}

export interface ProviderScorer {
  player: { id: number; name: string; nationality: string | null };
  team: { id: number; name: string };
  goals: number;
  assists: number | null;
  playedMatches: number | null;
}

export async function fetchMatches(): Promise<ProviderMatch[]> {
  const data = await get<{ matches: ProviderMatch[] }>(`/competitions/${COMPETITION_CODE}/matches`);
  return data.matches;
}

export async function fetchStandings(): Promise<ProviderStandingsGroup[]> {
  const data = await get<{ standings: ProviderStandingsGroup[] }>(
    `/competitions/${COMPETITION_CODE}/standings`
  );
  return data.standings;
}

/**
 * Top scorers. NOTE: football-data.org's free tier does not reliably provide
 * this for every competition — the sync job catches and logs failures here
 * rather than crashing the whole run. If this consistently 403s/empties out,
 * swap in a second provider (e.g. API-Football) for just this one call.
 */
export async function fetchScorers(): Promise<ProviderScorer[]> {
  const data = await get<{ scorers: ProviderScorer[] }>(`/competitions/${COMPETITION_CODE}/scorers?limit=50`);
  return data.scorers;
}

// ---- Status / stage mapping helpers (provider vocabulary → our schema) ----

export function mapStatus(status: ProviderMatch["status"]): "scheduled" | "live" | "finished" | "postponed" | "cancelled" {
  switch (status) {
    case "IN_PLAY":
    case "PAUSED":
      return "live";
    case "FINISHED":
      return "finished";
    case "POSTPONED":
    case "SUSPENDED":
      return "postponed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "scheduled";
  }
}

export function mapStage(stage: string): MatchRound {
  switch (stage) {
    case "GROUP_STAGE":
      return "Group Stage";
    case "LAST_32":
      return "Round of 32";
    case "LAST_16":
      return "Round of 16";
    case "QUARTER_FINALS":
      return "Quarter-final";
    case "SEMI_FINALS":
      return "Semi-final";
    case "THIRD_PLACE":
      return "Match for third place";
    case "FINAL":
      return "Final";
    default:
      // Unrecognized provider stage code — default to Group Stage rather
      // than passing the raw string through, since callers now require a
      // genuine MatchRound (e.g. isKnockoutRound() in sync.ts).
      return "Group Stage";
  }
}

export function groupLetterFromProviderGroup(group: string | null): string | null {
  // Provider returns "GROUP_A" / "Group A" depending on endpoint — normalize both.
  if (!group) return null;
  const m = group.match(/([A-L])\s*$/i);
  return m ? m[1].toUpperCase() : null;
}


// ---- Per-match detail (goals, bookings, substitutions) ----
// Available on the free tier for WC matches.

export interface ProviderGoal {
  minute: number | null;
  injuryTime: number | null;
  type: "NORMAL" | "OWN_GOAL" | "PENALTY";
  team: { id: number; name: string } | null;
  scorer: { id: number; name: string } | null;
  assist: { id: number; name: string } | null;
}

export interface ProviderMatchDetail {
  id: number;
  goals: ProviderGoal[];
}

export async function fetchMatchDetail(matchId: number): Promise<ProviderMatchDetail> {
  const data = await get<ProviderMatchDetail & { goals?: ProviderGoal[] }>(`/matches/${matchId}`);
  return { id: data.id, goals: data.goals ?? [] };
}
