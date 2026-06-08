// ============================================================================
// Server-side data access for the live-data viewing pages (src/app/**/page.tsx).
//
// These all run in Server Components via the cookie-aware Supabase client
// (createServerSupabaseClient — respects RLS, so visitors only ever see what
// the policies in supabase/migrations/0002_row_level_security.sql allow:
// tournament data — teams, matches, standings, scorers — is public-read by
// design, which is exactly what these pages need).
//
// Kept thin and table-shaped on purpose: the sync job
// (scripts/sync-live-data.ts) is the only writer, so reads here are a direct
// reflection of "what football-data.org reported as of the last sync run."
// ============================================================================

import { createServerSupabaseClient } from "./supabase/server";
import type { Match, Standing, Team, TopScorer } from "./types";

/** id → display name, for resolving team_id columns in the UI. */
export async function getTeamNameMap(): Promise<Map<string, string>> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("teams").select("id, name");
  if (error) throw error;
  return new Map((data as Pick<Team, "id" | "name">[]).map((t) => [t.id, t.name]));
}

/** All teams, alphabetical — backs the team picker on the tournament-award prediction page. */
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

/** Matches currently in progress — the "what's on right now" view. */
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

/** Next scheduled matches (soonest first) — used on the overview when nothing's live. */
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

/** Most recently finished matches (latest first) — "results" strip on the overview. */
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

/**
 * A zero-value standings row for a team that hasn't played yet — same shape
 * as a real `standings` row (minus a stable `id`/`updated_at`, which the
 * sync job assigns once it materializes the row from results).
 */
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
 * Group standings (A–L), each table sorted by rank.
 *
 * Groups whose matches haven't kicked off yet have no rows in `standings`
 * (the sync job only materializes a group's table once results start coming
 * in) — for those, we backfill all four rostered teams as zero-value rows
 * (sorted alphabetically) so the page always shows a complete table instead
 * of an empty state.
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

  // Backfill: any group with no materialized standings yet gets a full
  // four-team table of zero rows, built straight from the team roster.
  // (Snapshot which groups are already materialized *before* adding blanks —
  // otherwise the first backfilled team would mark its group as "already has
  // rows" and the other three teams would be skipped.)
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

/** Most recent sync timestamp, derived from `matches.updated_at` — shown as a freshness indicator. */
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
