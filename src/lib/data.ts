// ============================================================================
// Server-side data access for the live-data viewing pages (src/app/**/page.tsx).
// ============================================================================

import { createServerSupabaseClient, createServiceRoleClient } from "./supabase/server";
import type { Match, MatchEvent, Standing, Team, TopScorer } from "./types";

/** id -> display name, for resolving team_id columns in the UI. */
export async function getTeamNameMap(): Promise<Map<string, string>> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("teams").select("id, name");
  if (error) throw error;
  return new Map((data as Pick<Team, "id" | "name">[]).map((t) => [t.id, t.name]));
}

/** All teams, alphabetical. */
export async function getTeams(): Promise<Team[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("teams").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data as Team[];
}

/** All 104 matches, ordered for schedule display (kickoff order). */
export async function getMatches(): Promise<Match[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("matches").select("*").order("kickoff_at", { ascending: true });
  if (error) throw error;
  return data as Match[];
}

/** Matches currently in progress. */
export async function getLiveMatches(): Promise<Match[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "live")
    .order("kickoff_at", { ascending: true });
  if (error) throw error;
  return data as Match[];
}

/** Next scheduled matches (soonest first). */
export async function getUpcomingMatches(limit = 6): Promise<Match[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "scheduled")
    .order("kickoff_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data as Match[];
}

/** Most recently finished matches (latest first). */
export async function getRecentResults(limit = 6): Promise<Match[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("status", "finished")
    .order("kickoff_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as Match[];
}

export interface GroupStanding extends Standing {
  team_name: string;
  flag_emoji?: string | null;
}

function blankStanding(
  teamId: string,
  groupLetter: string,
  teamName: string,
  flagEmoji?: string | null,
): GroupStanding {
  return {
    id: `pending-${teamId}`,
    group_letter: groupLetter,
    team_id: teamId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    goal_diff: 0,
    points: 0,
    rank: null,
    updated_at: "",
    team_name: teamName,
    flag_emoji: flagEmoji ?? null,
  };
}

/**
 * Group standings (A-L), each table sorted by rank.
 *
 * Three-layer fallback to guarantee all 48 teams appear:
 *   1. Standings table (has computed data after recompute).
 *   2. Teams table (group_letter IS NOT NULL) -- adds zero-rows for any
 *      individual team missing from standings, not just empty groups.
 *   3. Group-stage match data -- catches teams whose group_letter is NULL
 *      in the teams table (e.g. API-synced duplicates) but ARE referenced
 *      in matches.
 */
export async function getStandingsByGroup(): Promise<Map<string, GroupStanding[]>> {
  const supabase = createServerSupabaseClient();

  const [standingsRes, teamsRes, matchesRes] = await Promise.all([
    supabase
      .from("standings")
      .select("*, teams(name, flag_emoji)")
      .order("group_letter", { ascending: true })
      .order("rank", { ascending: true, nullsFirst: false }),
    supabase
      .from("teams")
      .select("id, name, group_letter, flag_emoji")
      .not("is_placeholder", "is", null)
      .order("name", { ascending: true }),
    supabase
      .from("matches")
      .select("group_letter, team1_id, team2_id")
      .eq("round", "Group Stage")
      .not("group_letter", "is", null),
  ]);
  if (standingsRes.error) throw standingsRes.error;
  if (teamsRes.error) throw teamsRes.error;
  // matchesRes failure is non-fatal -- we still show what we have.

  // \u2500\u2500 Layer 1: build from standings table \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const byGroup = new Map<string, GroupStanding[]>();
  for (const row of standingsRes.data as Array<Standing & { teams: { name: string; flag_emoji: string | null } | null }>) {
    const { teams, ...rest } = row;
    const entry: GroupStanding = { ...rest, team_name: teams?.name ?? "Unknown", flag_emoji: teams?.flag_emoji ?? null };
    const list = byGroup.get(entry.group_letter) ?? [];
    list.push(entry);
    byGroup.set(entry.group_letter, list);
  }

  // Track which team IDs are already accounted for.
  const seen = new Set<string>();
  for (const rows of byGroup.values()) {
    for (const r of rows) seen.add(r.team_id);
  }

  // Build a name + group lookup from ALL teams (including those with NULL group_letter).
  const teamById = new Map<string, { name: string; group_letter: string | null; flag_emoji: string | null }>();
  for (const t of teamsRes.data as Array<{ id: string; name: string; group_letter: string | null; flag_emoji: string | null }>) {
    teamById.set(t.id, { name: t.name, group_letter: t.group_letter, flag_emoji: t.flag_emoji ?? null });
  }

  // \u2500\u2500 Layer 2: zero-rows for teams in the teams table with group_letter set \u2500
  for (const [id, t] of teamById) {
    if (!t.group_letter || seen.has(id)) continue;
    const list = byGroup.get(t.group_letter) ?? [];
    list.push(blankStanding(id, t.group_letter, t.name, t.flag_emoji));
    byGroup.set(t.group_letter, list);
    seen.add(id);
  }

  // \u2500\u2500 Layer 3: zero-rows for teams found only via match data \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (!matchesRes.error && matchesRes.data) {
    for (const m of matchesRes.data as Array<{
      group_letter: string | null;
      team1_id: string | null;
      team2_id: string | null;
    }>) {
      if (!m.group_letter) continue;
      for (const tid of [m.team1_id, m.team2_id]) {
        if (!tid || seen.has(tid)) continue;
        const info = teamById.get(tid);
        const name = info?.name ?? "Unknown";
        const list = byGroup.get(m.group_letter) ?? [];
        list.push(blankStanding(tid, m.group_letter, name, info?.flag_emoji));
        byGroup.set(m.group_letter, list);
        seen.add(tid);
      }
    }
  }

  return byGroup;
}

export interface ScorerRow extends TopScorer {
  team_name: string | null;
}

/** Golden Boot race, ranked. */
export async function getTopScorers(): Promise<ScorerRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("top_scorers")
    .select("*, teams(name)")
    .order("rank", { ascending: true, nullsFirst: false });
  if (error) throw error;

  return (data as Array<TopScorer & { teams: { name: string } | null }>).map(({ teams, ...rest }) => ({
    ...rest,
    team_name: teams?.name ?? null,
  }));
}

// ----------------------------------------------------------------------------
// Pre-kickoff consensus
// ----------------------------------------------------------------------------

export interface ConsensusData {
  total: number;
  home_win_count: number;
  draw_count: number;
  away_win_count: number;
}

export async function getMatchConsensus(matchIds: string[]): Promise<Map<string, ConsensusData>> {
  if (matchIds.length === 0) return new Map();
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("match_predictions")
    .select("match_id, predicted_home, predicted_away")
    .in("match_id", matchIds);
  if (error) throw error;

  const result = new Map<string, ConsensusData>();
  for (const pred of (data ?? []) as { match_id: string; predicted_home: number; predicted_away: number }[]) {
    const entry = result.get(pred.match_id) ?? { total: 0, home_win_count: 0, draw_count: 0, away_win_count: 0 };
    entry.total += 1;
    if (pred.predicted_home > pred.predicted_away) entry.home_win_count += 1;
    else if (pred.predicted_home === pred.predicted_away) entry.draw_count += 1;
    else entry.away_win_count += 1;
    result.set(pred.match_id, entry);
  }
  return result;
}

// ----------------------------------------------------------------------------
// W/D/L outcome accuracy
// ----------------------------------------------------------------------------

export interface OutcomeAccuracyRow {
  correct: number;
  total: number;
}

/**
 * Per-participant W/D/L prediction accuracy for all finished matches.
 * "Correct" means sign(predicted_home - predicted_away) === sign(actual_home - actual_away).
 */
export async function getOutcomeAccuracy(): Promise<Map<string, OutcomeAccuracyRow>> {
  const supabase = createServiceRoleClient();

  const { data: finishedMatches, error: mErr } = await supabase
    .from("matches")
    .select("id, home_score, away_score")
    .eq("status", "finished")
    .not("home_score", "is", null)
    .not("away_score", "is", null);
  if (mErr) throw mErr;
  if (!finishedMatches || finishedMatches.length === 0) return new Map();

  const matchScores = new Map<string, { home: number; away: number }>(
    (finishedMatches as { id: string; home_score: number; away_score: number }[]).map((m) => [
      m.id,
      { home: m.home_score, away: m.away_score },
    ])
  );

  const matchIds = Array.from(matchScores.keys());
  const { data: preds, error: pErr } = await supabase
    .from("match_predictions")
    .select("participant_id, match_id, predicted_home, predicted_away")
    .in("match_id", matchIds);
  if (pErr) throw pErr;

  const result = new Map<string, OutcomeAccuracyRow>();
  for (const p of (preds ?? []) as {
    participant_id: string;
    match_id: string;
    predicted_home: number;
    predicted_away: number;
  }[]) {
    const actual = matchScores.get(p.match_id);
    if (!actual) continue;
    const entry = result.get(p.participant_id) ?? { correct: 0, total: 0 };
    entry.total += 1;
    const predSign = Math.sign(p.predicted_home - p.predicted_away);
    const actualSign = Math.sign(actual.home - actual.away);
    if (predSign === actualSign) entry.correct += 1;
    result.set(p.participant_id, entry);
  }
  return result;
}

// ----------------------------------------------------------------------------
// Knockout matches for bracket visual
// ----------------------------------------------------------------------------

/** All knockout-round matches plus whether every group-stage match is finished. */
export async function getKnockoutMatches(): Promise<{
  matches: Match[];
  allGroupStageFinished: boolean;
}> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .order("match_number", { ascending: true });
  if (error) throw error;
  const all = data as Match[];
  const groupMatches = all.filter((m) => m.round === "Group Stage");
  const knockoutMatches = all.filter((m) => m.round !== "Group Stage");
  const allGroupStageFinished =
    groupMatches.length > 0 && groupMatches.every((m) => m.status === "finished");
  return { matches: knockoutMatches, allGroupStageFinished };
}

/** Kickoff time of the first match — used to lock all tournament award picks simultaneously. */
export async function getFirstMatchKickoff(): Promise<string | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("matches")
    .select("kickoff_at")
    .order("kickoff_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.kickoff_at ?? null;
}

/** Most recent sync timestamp. */
export async function getLastSyncedAt(): Promise<string | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("matches")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.updated_at ?? null;
}


// ----------------------------------------------------------------------------
// Match events (goals, own goals, penalties) for finished matches
// ----------------------------------------------------------------------------

export async function getMatchEvents(matchIds: string[]): Promise<Map<string, MatchEvent[]>> {
  if (matchIds.length === 0) return new Map();
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("match_events")
    .select("*")
    .in("match_id", matchIds)
    .order("minute", { ascending: true, nullsFirst: false });
  if (error) throw error;
  const result = new Map<string, MatchEvent[]>();
  for (const event of (data ?? []) as MatchEvent[]) {
    const list = result.get(event.match_id) ?? [];
    list.push(event);
    result.set(event.match_id, list);
  }
  return result;
}
