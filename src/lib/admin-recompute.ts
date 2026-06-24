// ============================================================================
// Shared recompute logic -- imported by both:
//   * POST /api/admin/recompute  (explicit "Recompute All" button)
//   * POST /api/admin/update-match  (auto-recompute on every admin save)
//
// recomputeAll(supabase)
//   (0) Normalises team names (e.g. Turkiye -> Turkey, USA -> United States of America)
//   (1) Patches team.group_letter for any team whose group is null (sync artifact)
//   (2) Rescores predictions for every finished match
//   (3) Recomputes group standings from match results
//   (4) Resolves knockout bracket slot codes (1X/2X/3X/WN/LN)
//
// recomputeStandingsAndBracket(supabase)
//   Same as above but skips step (2). Used by update-match after it has
//   already scored the single updated match inline.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreMatchPrediction } from "./scoring";
import { isKnockoutRound } from "./match-utils";
import type { MatchRound, WinnerSide } from "./types";

// -- Internal types -----------------------------------------------------------

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
  /** Actual winner (team1/team2 slot), including penalty-shootout outcomes.
   *  Null for a group-stage draw. See migration 0012. */
  winner_side: WinnerSide | null;
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

// -- Step 0a: Normalize team names --------------------------------------------
//
// Live-data sync sometimes creates records with API name variants that differ
// from our canonical names. This patches those rows so the standings and UI
// always use the names the admin configured.
// Idempotent -- only runs UPDATE when a matching variant exists.

const TEAM_NAME_ALIASES: Record<string, string> = {
  // Turkey
  "Turkiye": "Turkey",
  "Türkiye": "Turkey",
  // Bosnia and Herzegovina
  "Bosnia & Herzegovina": "Bosnia and Herzegovina",
  "Bosnia-Herzegovina": "Bosnia and Herzegovina",
  // United States of America
  "United States": "United States of America",
  "USA": "United States of America",
  // DR Congo
  "Congo DR": "DR Congo",
  "Democratic Republic of Congo": "DR Congo",
  "Democratic Republic of the Congo": "DR Congo",
  // Other common variants
  "Ivory Coast": "Ivory Coast",
  "Cote d'Ivoire": "Ivory Coast",
  "Cote dIvoire": "Ivory Coast",
  "Czech Republic": "Czechia",
  "Republic of Korea": "South Korea",
};

async function patchTeamNames(supabase: SupabaseClient): Promise<number> {
  let patched = 0;
  for (const [variant, canonical] of Object.entries(TEAM_NAME_ALIASES)) {
    if (variant === canonical) continue;
    const { error } = await supabase
      .from("teams")
      .update({ name: canonical })
      .eq("name", variant);
    if (!error) patched++;
  }
  return patched;
}

// -- Step 0b: Patch missing team group_letters --------------------------------
//
// When the live-data sync creates team records from the API, it sometimes
// uses a different name variant than what was seeded (e.g. "Turkey" vs
// "Turkiye"), resulting in a new team row with group_letter = NULL. This
// function infers the correct group from match data and patches those rows.
// Idempotent -- only updates rows where group_letter IS NULL.

async function patchTeamGroupLetters(
  supabase: SupabaseClient,
  matches: DbMatch[]
): Promise<number> {
  const updates: Array<{ id: string; group_letter: string }> = [];
  for (const m of matches) {
    if (m.round !== "Group Stage" || !m.group_letter) continue;
    for (const tid of [m.team1_id, m.team2_id]) {
      if (tid) updates.push({ id: tid, group_letter: m.group_letter });
    }
  }

  // Deduplicate by team_id
  const seen = new Set<string>();
  let patched = 0;
  for (const u of updates) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    const { error } = await supabase
      .from("teams")
      .update({ group_letter: u.group_letter })
      .eq("id", u.id)
      .is("group_letter", null);
    if (!error) patched++;
  }
  return patched;
}

// -- Step 1: Rescore all finished match predictions ---------------------------

async function rescoreAllFinishedMatches(
  supabase: SupabaseClient,
  matches: DbMatch[]
): Promise<number> {
  const finished = matches.filter(
    (m) => m.status === "finished" && m.home_score !== null && m.away_score !== null
  );

  // Each finished match's predictions are scored concurrently via Promise.all
  // (was a sequential for-await loop — same end result, far fewer round trips
  // when many matches need rescoring at once, e.g. after a bulk score fix).
  const perMatchCounts = await Promise.all(
    finished.map(async (m) => {
      const { data: predictions, error } = await supabase
        .from("match_predictions")
        .select("id, predicted_home, predicted_away, predicted_winner_side")
        .eq("match_id", m.id);

      if (error || !predictions?.length) return 0;

      const isKnockout = isKnockoutRound(m.round as MatchRound);

      await Promise.all(
        (predictions as { id: string; predicted_home: number; predicted_away: number; predicted_winner_side: WinnerSide | null }[]).map(
          async (p) => {
            const { points, breakdown } = scoreMatchPrediction({
              predictedHome: p.predicted_home,
              predictedAway: p.predicted_away,
              actualHome: m.home_score!,
              actualAway: m.away_score!,
              isKnockout,
              predictedWinnerSide: p.predicted_winner_side,
              actualWinnerSide: m.winner_side,
            });
            await supabase
              .from("match_predictions")
              .update({ points_awarded: points, score_breakdown: breakdown })
              .eq("id", p.id);
          }
        )
      );

      return predictions.length;
    })
  );

  return perMatchCounts.reduce((sum, n) => sum + n, 0);
}

// -- Step 2: Compute group standings ------------------------------------------

export function computeStandings(
  teams: DbTeam[],
  matches: DbMatch[]
): Map<string, TeamStats[]> {
  const statsMap = new Map<string, Map<string, TeamStats>>();

  function zeroStats(teamId: string): TeamStats {
    return {
      team_id: teamId, played: 0, won: 0, drawn: 0, lost: 0,
      goals_for: 0, goals_against: 0, goal_diff: 0, points: 0, rank: 0,
    };
  }

  // Seed groups from team records where group_letter is already set.
  for (const t of teams) {
    if (t.is_placeholder || !t.group_letter) continue;
    const g = t.group_letter;
    if (!statsMap.has(g)) statsMap.set(g, new Map());
    statsMap.get(g)!.set(t.id, zeroStats(t.id));
  }

  // Also seed groups directly from match data -- catches teams whose
  // group_letter is NULL in the teams table (e.g. API-synced duplicates).
  for (const m of matches) {
    if (m.round !== "Group Stage" || !m.group_letter || !m.team1_id || !m.team2_id) continue;
    const g = m.group_letter;
    if (!statsMap.has(g)) statsMap.set(g, new Map());
    const groupMap = statsMap.get(g)!;
    if (!groupMap.has(m.team1_id)) groupMap.set(m.team1_id, zeroStats(m.team1_id));
    if (!groupMap.has(m.team2_id)) groupMap.set(m.team2_id, zeroStats(m.team2_id));
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
      if (!groupMap.has(tid)) groupMap.set(tid, zeroStats(tid));
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

// -- Step 3: Upsert standings rows --------------------------------------------

async function upsertStandings(
  supabase: SupabaseClient,
  standings: Map<string, TeamStats[]>
): Promise<void> {
  // Reset all rows to 0 first -- clears stale data when a result is removed
  await supabase.from("standings").update({
    played: 0, won: 0, drawn: 0, lost: 0,
    goals_for: 0, goals_against: 0, points: 0, rank: null,
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
        points: t.points, rank: t.rank,
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (rows.length > 0) {
    await supabase
      .from("standings")
      .upsert(rows, { onConflict: "group_letter,team_id" });
  }
}

// -- Step 4: Resolve knockout slot codes --------------------------------------

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

  // W73/L73-style codes: "winner/loser of match #73". Resolved from
  // winner_side, NOT from comparing home_score/away_score directly — those
  // columns hold the 90min+ET score with penalty-shootout goals stripped
  // (regulationAndExtraTimeScore() in providers/football-data.ts), so a
  // shootout-decided match always shows a tie there. winner_side is
  // populated independent of that stripping (sync.ts maps the provider's
  // score.winner, which does account for penalties) and so resolves
  // correctly regardless of how the match was decided. See migration 0012.
  const mW = /^W(\d+)$/.exec(code);
  if (mW) {
    const m = matchByNumber.get(Number(mW[1]));
    if (!m || m.status !== "finished" || !m.winner_side) return null;
    return m.winner_side === "team1" ? m.team1_id : m.team2_id;
  }

  const mL = /^L(\d+)$/.exec(code);
  if (mL) {
    const m = matchByNumber.get(Number(mL[1]));
    if (!m || m.status !== "finished" || !m.winner_side) return null;
    return m.winner_side === "team1" ? m.team2_id : m.team1_id;
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

// -- Helper: patch names + fetch matches + patch group letters + re-fetch teams

async function fetchAndPatchData(supabase: SupabaseClient): Promise<{ matches: DbMatch[]; teams: DbTeam[] }> {
  // Normalize name variants first (e.g. "Turkiye" -> "Turkey").
  await patchTeamNames(supabase);

  const { data: matchData, error: matchErr } = await supabase
    .from("matches")
    .select("id, match_number, round, group_letter, team1_code, team2_code, team1_id, team2_id, home_score, away_score, status, winner_side")
    .order("match_number", { ascending: true });
  if (matchErr) throw new Error(matchErr.message);

  const matches = matchData as DbMatch[];

  // Patch any teams whose group_letter is NULL but appear in group stage matches.
  await patchTeamGroupLetters(supabase, matches);

  // Re-fetch teams so computeStandings sees the patched group letters.
  const { data: teamData, error: teamErr } = await supabase
    .from("teams")
    .select("id, group_letter, is_placeholder");
  if (teamErr) throw new Error(teamErr.message);

  return { matches, teams: teamData as DbTeam[] };
}

// -- Public API ---------------------------------------------------------------

export interface RecomputeResult {
  predictionsRescored: number;
  groupsRecomputed: number;
  slotsUpdated: number;
}

/** Full recompute: normalises names + patches team groups + rescores all predictions + standings + bracket. */
export async function recomputeAll(supabase: SupabaseClient): Promise<RecomputeResult> {
  const { matches, teams } = await fetchAndPatchData(supabase);

  const [predictionsRescored, standings] = await Promise.all([
    rescoreAllFinishedMatches(supabase, matches),
    Promise.resolve(computeStandings(teams, matches)),
  ]);

  await upsertStandings(supabase, standings);
  const slotsUpdated = await resolveKnockoutSlots(supabase, matches, standings);

  return { predictionsRescored, groupsRecomputed: standings.size, slotsUpdated };
}

/**
 * Standings + bracket recompute only -- skips rescoring predictions.
 * Call this after update-match has already scored the specific match inline.
 */
export async function recomputeStandingsAndBracket(
  supabase: SupabaseClient
): Promise<{ groupsRecomputed: number; slotsUpdated: number }> {
  const { matches, teams } = await fetchAndPatchData(supabase);

  const standings = computeStandings(teams, matches);
  await upsertStandings(supabase, standings);
  const slotsUpdated = await resolveKnockoutSlots(supabase, matches, standings);

  return { groupsRecomputed: standings.size, slotsUpdated };
}
