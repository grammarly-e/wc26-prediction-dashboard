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
    // "Running total" score — for PENALTY_SHOOTOUT matches this includes the
    // shootout goals added on top of the 90+ET score (e.g. a 1-1 draw decided
    // 6-5 on penalties comes back as fullTime 7-6). Use
    // regulationAndExtraTimeScore() below to strip the shootout back out.
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
 * The score after 90 minutes + extra time, deliberately excluding penalty
 * shootout goals — so a knockout match decided on penalties still registers
 * as the draw it was in open play (W/D/L), rather than as a "win" for
 * whoever won the shootout. REGULAR and EXTRA_TIME duration matches are
 * unaffected; fullTime is already the right number for those.
 */
export function regulationAndExtraTimeScore(
  score: ProviderMatch["score"]
): { home: number | null; away: number | null } {
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

export function mapStage(stage: string): string {
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
      return stage;
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
