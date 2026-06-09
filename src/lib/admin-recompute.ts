// ============================================================================
// Shared recompute logic — imported by both:
//   • POST /api/admin/recompute  (explicit "Recompute All" button)
//   • POST /api/admin/update-match  (auto-recompute on every admin save)
//
// recomputeAll(supabase)
//   ① Rescores predictions for every finished match (applies updated SCORING
//      constants — useful after a scoring system change)
//   ② Recomputes group standings from match results
//   ③ Resolves knockout bracket slot codes (1X/2X/3X/WN/LN)
//
// recomputeStandingsAndBracket(supabase)
//   Same as above, but skips step ①. Used by update-match after it has
//   already scored the single updated match inline.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreMatchPrediction } from "./scoring";

// ── Internal types ────────────────────────────────────────────────────────────

interface DbMatch {
  id: string;
  match_number: number;
  round: string;
  group_letter: string | null;
  team1_code: string;
  team2_code: string;
  team1_id: string | null;
  team2_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
}

interface DbTeam {
  id: string;
  group_letter: string | null;
  is_placeholder: boolean;
}

interface TeamStats {
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  rank: number;
}

interface ThirdEntry {
  group_letter: string;
  team_id: string;
  points: number;
  goal_diff: number;
  goals_for: number;
}

// ── Step 0: Rescore all finished match predictions ────────────────────────────
//
// Iterates every finished match, re-runs scoreMatchPrediction for each
// prediction, and writes the updated points_awarded + score_breakdown back.
// This makes a scoring-system change take effect on all historical data.

async function rescoreAllFinishedMatches(
  supabase: SupabaseClient,
  matches: DbMatch[]
): Promise<number> {
  const finished = matches.filter(
    (m) => m.status === "finished" && m.home_score !== null && m.away_score !== null
  );

  let rescored = 0;
  for (const m of finished) {
    const { data: predictions, error } = await supabase
      .from("match_predictions")
      .select("id, predicted_home, predicted_away")
      .eq("match_id", m.id);

    if (error || !predictions?.length) continue;

    for (const p of predictions as { id: string; predicted_home: number; predicted_away: number }[]) {
      const { points, breakdown } = scoreMatchPrediction({
        predictedHome: p.predicted_home,
        predictedAway: p.predicted_away,
        actualHome: m.home_score!,
        actualAway: m.away_score!,
      });
      await supabase
        .from("match_predictions")
        .update({ points_awarded: points, score_breakdown: breakdown })
        .eq("id", p.id);
      rescored++;
    }
  }
  return rescored;
}

// ── Step 1: Compute group standings ──────────────────────────────────────────

export function computeStandings(
  teams: DbTeam[],
  matches: DbMatch[]
): Map<string, TeamStats[]> {
  const statsMap = new Map<string, Map<string, TeamStats>>();
  for (const t of teams) {
    if (t.is_placeholder || !t.group_letter) continue;
    const g = t.group_letter;
    if (!statsMap.has(g)) statsMap.set(g, new Map());
    statsMap.get(g)!.set(t.id, {
      team_id: t.id, played: 0, won: 0, drawn: 0, lost: 0,
      goals_for: 0, goals_against: 0, goal_diff: 0, points: 0, rank: 0,
    });
  }

  for (const m of matches) {
    if (
      m.round !== "Group Stage" ||
      m.status !== "finished" ||
      !m.group_letter ||
      m.home_score === null ||
      m.away_score === null ||
      !m.team1_id ||
      !m.team2_id
    ) continue;

    const g = m.group_letter;
    const groupMap = statsMap.get(g);
    if (!groupMap) continue;

    for (const tid of [m.team1_id, m.team2_id]) {
      if (!groupMap.has(tid)) {
        groupMap.set(tid, {
          team_id: tid, played: 0, won: 0, drawn: 0, lost: 0,
          goals_for: 0, goals_against: 0, goal_diff: 0, points: 0, rank: 0,
        });
      }
    }

    const t1 = groupMap.get(m.team1_id)!;
    const t2 = groupMap.get(m.team2_id)!;

    t1.played++; t2.played++;
    t1.goals_for  += m.home_score; t1.goals_against += m.away_score;
    t2.goals_for  += m.away_score; t2.goals_against += m.home_score;

    if (m.home_score > m.away_score) {
      t1.won++; t1.points += 3; t2.lost++;
    } else if (m.away_score > m.home_score) {
      t2.won++; t2.points += 3; t1.lost++;
    } else {
      t1.drawn++; t1.points++; t2.drawn++; t2.points++;
    }

    t1.goal_diff = t1.goals_for - t1.goals_against;
    t2.goal_diff = t2.goals_for - t2.goals_against;
  }

  const result = new Map<string, TeamStats[]>();
  for (const [g, teamMap] of statsMap) {
    const sorted = Array.from(teamMap.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
      return b.goals_for - a.goals_for;
    });
    sorted.forEach((t, i) => { t.rank = i + 1; });
    result.set(g, sorted);
  }
  return result;
}

// ── Step 2: Upsert standings rows ─────────────────────────────────────────────

async function upsertStandings(
  supabase: SupabaseClient,
  standings: Map<string, TeamStats[]>
): Promise<void> {
  // Reset all rows to 0 first — clears stale data when a result is removed
  await supabase.from("standings").update({
    played: 0, won: 0, drawn: 0, lost: 0,
    goals_for: 0, goals_against: 0, goal_diff: 0, points: 0, rank: null,
    updated_at: new Date().toISOString(),
  }).gte("played", 0);

  const rows = [];
  for (const [groupLetter, teams] of standings) {
    for (const t of teams) {
      rows.push({
        group_letter: groupLetter,
        team_id: t.team_id,
        played: t.played, won: t.won, drawn: t.drawn, lost: t.lost,
        goals_for: t.goals_for, goals_against: t.goals_against,
        goal_diff: t.goal_diff, points: t.points, rank: t.rank,
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (rows.length > 0) {
    // upsert creates rows that don't exist yet (pre-tournament) and updates existing ones
    await supabase
      .from("standings")
      .upsert(rows, { onConflict: "group_letter,team_id" });
  }
}

// ── Step 3: Resolve knockout slot codes ───────────────────────────────────────

function resolveSlotCode(
  code: string,
  groupWinners: Map<string, string>,
  groupRunnersUp: Map<string, string>,
  thirds: ThirdEntry[],
  assignedThirds: Set<string>,
  matchByNumber: Map<number, DbMatch>
): string | null {
  const m1 = /^1([A-L])$/.exec(code);
  if (m1) return groupWinners.get(m1[1]) ?? null;

  const m2 = /^2([A-L])$/.exec(code);
  if (m2) return groupRunnersUp.get(m2[1]) ?? null;

  const m3 = /^3([A-L](?:\/[A-L])*)$/.exec(code);
  if (m3) {
    const eligible = new Set(m3[1].split("/"));
    for (const entry of thirds) {
      if (eligible.has(entry.group_letter) && !assignedThirds.has(entry.team_id)) {
        assignedThirds.add(entry.team_id);
        return entry.team_id;
      }
    }
    return null;
  }

  const mW = /^W(\d+)$/.exec(code);
  if (mW) {
    const m = matchByNumber.get(Number(mW[1]));
    if (!m || m.status !== "finished" || m.home_score === null || m.away_score === null) return null;
    if (m.home_score > m.away_score) return m.team1_id;
    if (m.away_score > m.home_score) return m.team2_id;
    return null;
  }

  const mL = /^L(\d+)$/.exec(code);
  if (mL) {
    const m = matchByNumber.get(Number(mL[1]));
    if (!m || m.status !== "finished" || m.home_score === null || m.away_score === null) return null;
    if (m.home_score > m.away_score) return m.team2_id;
    if (m.away_score > m.home_score) return m.team1_id;
    return null;
  }

  return null;
}

async function resolveKnockoutSlots(
  supabase: SupabaseClient,
  matches: DbMatch[],
  standings: Map<string, TeamStats[]>
): Promise<number> {
  const groupWinners = new Map<string, string>();
  const groupRunnersUp = new Map<string, string>();
  const allThirds: ThirdEntry[] = [];

  for (const [g, teams] of standings) {
    if (teams[0]) groupWinners.set(g, teams[0].team_id);
    if (teams[1]) groupRunnersUp.set(g, teams[1].team_id);
    if (teams[2]) {
      allThirds.push({
        group_letter: g, team_id: teams[2].team_id,
        points: teams[2].points, goal_diff: teams[2].goal_diff, goals_for: teams[2].goals_for,
      });
    }
  }

  allThirds.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
    return b.goals_for - a.goals_for;
  });

  const assignedThirds = new Set<string>();
  const matchByNumber = new Map<number, DbMatch>();
  for (const m of matches) matchByNumber.set(m.match_number, m);

  const knockout = matches
    .filter((m) => m.round !== "Group Stage")
    .sort((a, b) => a.match_number - b.match_number);

  let updated = 0;
  for (const m of knockout) {
    const newT1 = resolveSlotCode(m.team1_code, groupWinners, groupRunnersUp, allThirds, assignedThirds, matchByNumber);
    const newT2 = resolveSlotCode(m.team2_code, groupWinners, groupRunnersUp, allThirds, assignedThirds, matchByNumber);

    const t1Final = newT1 ?? m.team1_id;
    const t2Final = newT2 ?? m.team2_id;
    const changed = t1Final !== m.team1_id || t2Final !== m.team2_id;

    if (changed) {
      const { error } = await supabase
        .from("matches")
        .update({ team1_id: t1Final, team2_id: t2Final, updated_at: new Date().toISOString() })
        .eq("id", m.id);
      if (!error) {
        matchByNumber.set(m.match_number, { ...m, team1_id: t1Final, team2_id: t2Final });
        updated++;
      }
    }
  }
  return updated;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RecomputeResult {
  predictionsRescored: number;
  groupsRecomputed: number;
  slotsUpdated: number;
}

/** Full recompute: rescores all predictions + standings + bracket. */
export async function recomputeAll(supabase: SupabaseClient): Promise<RecomputeResult> {
  const [matchRes, teamRes] = await Promise.all([
    supabase
      .from("matches")
      .select("id, match_number, round, group_letter, team1_code, team2_code, team1_id, team2_id, home_score, away_score, status")
      .order("match_number", { ascending: true }),
    supabase.from("teams").select("id, group_letter, is_placeholder"),
  ]);
  if (matchRes.error) throw new Error(matchRes.error.message);
  if (teamRes.error)  throw new Error(teamRes.error.message);

  const matches = matchRes.data as DbMatch[];
  const teams   = teamRes.data as DbTeam[];

  const [predictionsRescored, standings] = await Promise.all([
    rescoreAllFinishedMatches(supabase, matches),
    Promise.resolve(computeStandings(teams, matches)),
  ]);

  await upsertStandings(supabase, standings);
  const slotsUpdated = await resolveKnockoutSlots(supabase, matches, standings);

  return { predictionsRescored, groupsRecomputed: standings.size, slotsUpdated };
}

/**
 * Standings + bracket recompute only — skips rescoring predictions.
 * Call this after update-match has already scored the specific match inline,
 * to propagate the result to the standings table and bracket slots.
 */
export async function recomputeStandingsAndBracket(supabase: SupabaseClient): Promise<{ groupsRecomputed: number; slotsUpdated: number }> {
  const [matchRes, teamRes] = await Promise.all([
    supabase
      .from("matches")
      .select("id, match_number, round, group_letter, team1_code, team2_code, team1_id, team2_id, home_score, away_score, status")
      .order("match_number", { ascending: true }),
    supabase.from("teams").select("id, group_letter, is_placeholder"),
  ]);
  if (matchRes.error) throw new Error(matchRes.error.message);
  if (teamRes.error)  throw new Error(teamRes.error.message);

  const matches = matchRes.data as DbMatch[];
  const teams   = teamRes.data as DbTeam[];

  const standings = computeStandings(teams, matches);
  await upsertStandings(supabase, standings);
  const slotsUpdated = await resolveKnockoutSlots(supabase, matches, standings);

  return { groupsRecomputed: standings.size, slotsUpdated };
}
