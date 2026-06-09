// ============================================================================
// POST /api/admin/recompute
//
// Re-derives everything from the current match results in the DB:
//
//   1. Group standings — recomputed from scratch using all finished
//      Group Stage matches.  Every standings row is reset to 0 first
//      so removing a result (setting a match back to "scheduled") is
//      reflected correctly.
//
//   2. Knockout bracket slots — processed in match-number order so
//      dependencies resolve correctly:
//        • 1X / 2X  → Group X winner / runner-up (from standings)
//        • 3X/Y/Z   → Best available third-place from listed groups
//        • WN       → Winner of match N (requires N to be finished and
//                     already have team IDs resolved)
//        • LN       → Loser of match N (used for 3rd-place playoff)
//
// This is the "fake from start to finish" endpoint.  Call it after
// entering any batch of results via the admin match editor.
// ============================================================================

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

// ── Shared types ──────────────────────────────────────────────────────────────

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

// ── Step 1: Compute group standings ──────────────────────────────────────────
//
// Initialises every real (non-placeholder) group team to 0, then adds
// W/D/L tallies for every finished Group Stage match.

function computeStandings(
  teams: DbTeam[],
  matches: DbMatch[]
): Map<string, TeamStats[]> {
  // Initialise all real group teams at zero
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

  // Accumulate finished Group Stage results
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

    // Ensure entries exist even for teams not pre-seeded in `teams` table
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
    t1.goals_for += m.home_score;  t1.goals_against += m.away_score;
    t2.goals_for += m.away_score;  t2.goals_against += m.home_score;

    if (m.home_score > m.away_score) {
      t1.won++; t1.points += 3; t2.lost++;
    } else if (m.away_score > m.home_score) {
      t2.won++; t2.points += 3; t1.lost++;
    } else {
      t1.drawn++; t1.points += 1; t2.drawn++; t2.points += 1;
    }

    t1.goal_diff = t1.goals_for - t1.goals_against;
    t2.goal_diff = t2.goals_for - t2.goals_against;
  }

  // Sort each group (pts → GD → GF) and assign ranks
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
  // Reset everything to 0 first — this clears stale data when results are
  // removed or corrected
  await supabase.from("standings").update({
    played: 0, won: 0, drawn: 0, lost: 0,
    goals_for: 0, goals_against: 0, goal_diff: 0, points: 0, rank: null,
    updated_at: new Date().toISOString(),
  }).gte("played", 0); // update all rows

  for (const [groupLetter, teams] of standings) {
    for (const t of teams) {
      await supabase
        .from("standings")
        .update({
          played: t.played,
          won: t.won,
          drawn: t.drawn,
          lost: t.lost,
          goals_for: t.goals_for,
          goals_against: t.goals_against,
          goal_diff: t.goal_diff,
          points: t.points,
          rank: t.rank,
          updated_at: new Date().toISOString(),
        })
        .eq("team_id", t.team_id)
        .eq("group_letter", groupLetter);
    }
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
  // 1A–1L: group winner
  const m1 = /^1([A-L])$/.exec(code);
  if (m1) return groupWinners.get(m1[1]) ?? null;

  // 2A–2L: group runner-up
  const m2 = /^2([A-L])$/.exec(code);
  if (m2) return groupRunnersUp.get(m2[1]) ?? null;

  // 3X/Y/Z…: best unassigned third-place team whose group is in the list
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

  // WN: winner of match N
  const mW = /^W(\d+)$/.exec(code);
  if (mW) {
    const m = matchByNumber.get(Number(mW[1]));
    if (!m || m.status !== "finished" || m.home_score === null || m.away_score === null) return null;
    if (m.home_score > m.away_score) return m.team1_id;
    if (m.away_score > m.home_score) return m.team2_id;
    return null; // draw can't happen in knockout
  }

  // LN: loser of match N (third-place playoff)
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
  // Build group winner / runner-up maps
  const groupWinners = new Map<string, string>();
  const groupRunnersUp = new Map<string, string>();
  const allThirds: ThirdEntry[] = [];

  for (const [g, teams] of standings) {
    if (teams[0]) groupWinners.set(g, teams[0].team_id);
    if (teams[1]) groupRunnersUp.set(g, teams[1].team_id);
    if (teams[2]) {
      allThirds.push({
        group_letter: g,
        team_id: teams[2].team_id,
        points: teams[2].points,
        goal_diff: teams[2].goal_diff,
        goals_for: teams[2].goals_for,
      });
    }
  }

  // Sort third-place teams best-first so greedy assignment gives correct results
  allThirds.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
    return b.goals_for - a.goals_for;
  });

  const assignedThirds = new Set<string>();

  // Build a mutable match-by-number map (updated as we resolve slots so that
  // W/L codes for later rounds can chain correctly)
  const matchByNumber = new Map<number, DbMatch>();
  for (const m of matches) matchByNumber.set(m.match_number, m);

  // Process knockout matches in ascending match-number order
  const knockout = matches
    .filter((m) => m.round !== "Group Stage")
    .sort((a, b) => a.match_number - b.match_number);

  let updated = 0;

  for (const m of knockout) {
    const newT1 = resolveSlotCode(
      m.team1_code, groupWinners, groupRunnersUp, allThirds, assignedThirds, matchByNumber
    );
    const newT2 = resolveSlotCode(
      m.team2_code, groupWinners, groupRunnersUp, allThirds, assignedThirds, matchByNumber
    );

    const t1Final = newT1 ?? m.team1_id;
    const t2Final = newT2 ?? m.team2_id;
    const changed = t1Final !== m.team1_id || t2Final !== m.team2_id;

    if (changed) {
      const { error } = await supabase
        .from("matches")
        .update({ team1_id: t1Final, team2_id: t2Final, updated_at: new Date().toISOString() })
        .eq("id", m.id);

      if (!error) {
        // Update in-memory record so chained W/L codes resolve correctly
        matchByNumber.set(m.match_number, { ...m, team1_id: t1Final, team2_id: t2Final });
        updated++;
      }
    }
  }

  return updated;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Fetch all matches and teams in parallel
  const [matchRes, teamRes] = await Promise.all([
    supabase
      .from("matches")
      .select("id, match_number, round, group_letter, team1_code, team2_code, team1_id, team2_id, home_score, away_score, status")
      .order("match_number", { ascending: true }),
    supabase
      .from("teams")
      .select("id, group_letter, is_placeholder"),
  ]);

  if (matchRes.error) return NextResponse.json({ error: matchRes.error.message }, { status: 500 });
  if (teamRes.error)  return NextResponse.json({ error: teamRes.error.message }, { status: 500 });

  const matches = matchRes.data as DbMatch[];
  const teams   = teamRes.data as DbTeam[];

  // 1. Recompute group standings
  const standings = computeStandings(teams, matches);

  // 2. Persist standings
  await upsertStandings(supabase, standings);

  // 3. Resolve knockout bracket slots
  const slotsUpdated = await resolveKnockoutSlots(supabase, matches, standings);

  return NextResponse.json({
    ok: true,
    groupsRecomputed: standings.size,
    slotsUpdated,
  });
}
