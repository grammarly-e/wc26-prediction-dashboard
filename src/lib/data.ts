// ============================================================================
// Server-side data access for the live-data viewing pages (src/app/**/page.tsx).
// ============================================================================

import { createServerSupabaseClient, createServiceRoleClient } from "./supabase/server";
import type { Match, Standing, Team, TopScorer } from "./types";

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
}

function blankStanding(team: Pick<Team, "id" | "name" | "group_letter">): GroupStanding {
  return {
    id: `pending-${team.id}`,
    group_letter: team.group_letter ?? "",
    team_id: team.id,
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
    team_name: team.name,
  };
}

/**
 * Group standings (A-L), each table sorted by rank.
 * Groups with no materialized standings get zero-value rows from the team roster.
 */
export async function getStandingsByGroup(): Promise<Map<string, GroupStanding[]>> {
  const supabase = createServerSupabaseClient();

  const [standingsRes, teamsRes] = await Promise.all([
    supabase
      .from("standings")
      .select("*, teams(name)")
      .order("group_letter", { ascending: true })
      .order("rank", { ascending: true, nullsFirst: false }),
    supabase
      .from("teams")
      .select("id, name, group_letter")
      .not("group_letter", "is", null)
      .order("name", { ascending: true }),
  ]);
  if (standingsRes.error) throw standingsRes.error;
  if (teamsRes.error) throw teamsRes.error;

  const byGroup = new Map<string, GroupStanding[]>();
  for (const row of standingsRes.data as Array<Standing & { teams: { name: string } | null }>) {
    const { teams, ...rest } = row;
    const entry: GroupStanding = { ...rest, team_name: teams?.name ?? "Unknown" };
    const list = byGroup.get(entry.group_letter) ?? [];
    list.push(entry);
    byGroup.set(entry.group_letter, list);
  }

  const materializedGroups = new Set(byGroup.keys());
  for (const team of teamsRes.data as Array<Pick<Team, "id" | "name" | "group_letter">>) {
    const letter = team.group_letter;
    if (!letter || materializedGroups.has(letter)) continue;
    const list = byGroup.get(letter) ?? [];
    list.push(blankStanding(team));
    byGroup.set(letter, list);
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
