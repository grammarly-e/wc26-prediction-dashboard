// ============================================================================
// Live data sync — pulls fixtures/scores/standings/scorers from football-data.org
// and writes them into Supabase, then scores any newly-finished matches.
//
// This is the shared core, called from two places:
//   - scripts/sync-live-data.ts  → `npm run sync` (manual / local runs)
//   - src/app/api/sync/route.ts  → POST/GET /api/sync (Vercel Cron — see vercel.json)
//
// IMPORTANT: this module creates its Supabase client lazily, inside `runSync()`,
// and throws ordinary Errors rather than calling `process.exit()`. That's not
// a style nitpick — this file gets imported into a Next.js serverless function
// (the API route). A module-level `process.exit(1)` or a client constructed at
// import time with possibly-missing env vars would crash or break the whole
// function on import, not just the sync call. Keeping all of that inside the
// function body is what makes this safely importable from both contexts.
//
// What it does, in order:
//   1. Fetch all WC matches from the provider; match each to our `matches`
//      row by `external_id` (cached from a prior run) or by kickoff time +
//      team names (first run / placeholder resolution).
//   2. Resolve placeholder slots: when a provider match's home/away team
//      doesn't yet map to a real `teams` row, upsert the team and backfill
//      `team1_id`/`team2_id` on the match — this is how "UEFA Path D winner"
//      becomes "Italy" once qualification concludes.
//   3. Write score + status + external_id onto the match.
//   4. When a match transitions into "finished" for the first time, score
//      every submitted prediction for it via scoreMatchPrediction().
//   5. Refresh `standings` (group tables) and `top_scorers` (best effort —
//      see the caveat in src/lib/providers/football-data.ts).
//
// Respects football-data.org's free-tier rate limit (10 req/min): a full run
// makes at most 3 provider calls (matches, standings, scorers), so even a
// 1-minute cron interval would be safe. In production this runs every hour
// via GitHub Actions (.github/workflows/sync.yml), once daily via Vercel Cron
// as a backstop (vercel.json), and on-demand via /api/auto-sync whenever a
// visitor loads the app and data is older than 24 h.
// ============================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  fetchMatches,
  fetchScorers,
  fetchStandings,
  groupLetterFromProviderGroup,
  mapStage,
  mapStatus,
  type ProviderMatch,
} from "./providers/football-data";
import { scoreMatchPrediction } from "./scoring";
import type { Database } from "./types";

// ----------------------------------------------------------------------------
// Client setup (lazy — see note above on why this lives inside a function)
// ----------------------------------------------------------------------------

function getServiceRoleClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — set them in .env.local (local runs) " +
        "or your hosting provider's environment variables (deployed cron runs)."
    );
  }
  return createClient<Database>(url, key);
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

interface DbMatchRow {
  id: string;
  match_number: number;
  kickoff_at: string;
  team1_code: string;
  team2_code: string;
  team1_id: string | null;
  team2_id: string | null;
  status: string;
  external_id: string | null;
}

interface DbTeamRow {
  id: string;
  name: string;
  is_placeholder: boolean;
}

/** Fuzzy-ish name match: exact, then case-insensitive substring either way. */
function namesLikelyMatch(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (na === nb) return true;
  if (na.length > 3 && nb.includes(na)) return true;
  if (nb.length > 3 && na.includes(nb)) return true;
  return false;
}

/** Find (or create) the `teams` row for a provider team, resolving placeholders. */
async function resolveTeamId(
  supabase: SupabaseClient<Database>,
  providerTeamName: string,
  teamsByName: Map<string, DbTeamRow>,
  fallbackCode: string
): Promise<string> {
  // 1. Direct name match against existing real teams.
  const direct = teamsByName.get(providerTeamName.trim().toLowerCase());
  if (direct) return direct.id;

  // 2. Fuzzy match (provider names sometimes differ slightly from openfootball's,
  //    e.g. "United States" vs "USA").
  for (const team of teamsByName.values()) {
    if (namesLikelyMatch(team.name, providerTeamName)) return team.id;
  }

  // 3. No match — this is a newly-resolved slot (e.g. a playoff winner that
  //    just became known). Upsert a real team row for it.
  const { data, error } = await supabase
    .from("teams")
    .upsert({ name: providerTeamName, is_placeholder: false }, { onConflict: "name" })
    .select("id, name, is_placeholder")
    .single();

  if (error) {
    console.error(`  ! Failed to upsert resolved team "${providerTeamName}" (slot ${fallbackCode}): ${error.message}`);
    throw error;
  }

  teamsByName.set(data.name.trim().toLowerCase(), data as DbTeamRow);
  console.log(`  → Resolved placeholder slot "${fallbackCode}" to real team "${providerTeamName}"`);
  return data.id;
}

/** Match a provider fixture to one of our seeded `matches` rows. */
function findDbMatch(provider: ProviderMatch, dbMatches: DbMatchRow[]): DbMatchRow | undefined {
  // Prefer a previously-recorded external_id link (fast path, exact).
  const byExternalId = dbMatches.find((m) => m.external_id === String(provider.id));
  if (byExternalId) return byExternalId;

  // Otherwise match on kickoff time (within 3 hours, to absorb minor schedule
  // tweaks) — this is what lets us link before external_id has ever been set,
  // and to re-link if a placeholder's code text doesn't match the provider's
  // resolved team name.
  const providerKickoff = new Date(provider.utcDate).getTime();
  const candidates = dbMatches.filter((m) => {
    const dbKickoff = new Date(m.kickoff_at).getTime();
    return Math.abs(dbKickoff - providerKickoff) < 3 * 60 * 60 * 1000;
  });

  if (candidates.length === 1) return candidates[0];

  // Multiple same-time candidates (rare — simultaneous kickoffs): disambiguate
  // by team name overlap with the (possibly placeholder) codes we seeded.
  return candidates.find(
    (m) =>
      namesLikelyMatch(m.team1_code, provider.homeTeam.name) ||
      namesLikelyMatch(m.team2_code, provider.homeTeam.name) ||
      namesLikelyMatch(m.team1_code, provider.awayTeam.name) ||
      namesLikelyMatch(m.team2_code, provider.awayTeam.name)
  );
}

// ----------------------------------------------------------------------------
// Step 1+2+3: matches, team resolution, scores/status
// ----------------------------------------------------------------------------

async function syncMatches(supabase: SupabaseClient<Database>): Promise<{ newlyFinished: DbMatchRow[] }> {
  console.log("Fetching matches from football-data.org …");
  const providerMatches = await fetchMatches();

  const { data: dbMatches, error: matchesErr } = await supabase
    .from("matches")
    .select("id, match_number, kickoff_at, team1_code, team2_code, team1_id, team2_id, status, external_id");
  if (matchesErr) throw matchesErr;

  const { data: dbTeams, error: teamsErr } = await supabase.from("teams").select("id, name, is_placeholder");
  if (teamsErr) throw teamsErr;

  const teamsByName = new Map<string, DbTeamRow>(
    (dbTeams as DbTeamRow[]).filter((t) => !t.is_placeholder).map((t) => [t.name.trim().toLowerCase(), t])
  );

  const newlyFinished: DbMatchRow[] = [];
  let updated = 0;
  let unmatched = 0;

  for (const pm of providerMatches) {
    const dbMatch = findDbMatch(pm, dbMatches as DbMatchRow[]);
    if (!dbMatch) {
      unmatched++;
      continue;
    }

    const team1Id = dbMatch.team1_id ?? (await resolveTeamId(supabase, pm.homeTeam.name, teamsByName, dbMatch.team1_code));
    const team2Id = dbMatch.team2_id ?? (await resolveTeamId(supabase, pm.awayTeam.name, teamsByName, dbMatch.team2_code));

    const newStatus = mapStatus(pm.status);
    const wasFinished = dbMatch.status === "finished";
    const isNowFinished = newStatus === "finished";

    // Build the update conditionally: only touch `group_letter` when the
    // provider actually reports one (group-stage fixtures). Knockout fixtures
    // come back with group === null, and we must NOT clobber the seeded
    // group_letter on those rows.
    const providerGroupLetter = groupLetterFromProviderGroup(pm.group);
    const updatePayload: Record<string, unknown> = {
      external_id: String(pm.id),
      team1_id: team1Id,
      team2_id: team2Id,
      round: mapStage(pm.stage),
      home_score: pm.score.fullTime.home,
      away_score: pm.score.fullTime.away,
      status: newStatus,
    };
    if (providerGroupLetter) updatePayload.group_letter = providerGroupLetter;

    const { error: updateErr } = await supabase.from("matches").update(updatePayload).eq("id", dbMatch.id);

    if (updateErr) {
      console.error(`  ✗ Match #${dbMatch.match_number}: ${updateErr.message}`);
      continue;
    }

    updated++;
    if (isNowFinished && !wasFinished) {
      newlyFinished.push({ ...dbMatch, team1_id: team1Id, team2_id: team2Id, status: "finished" });
    }
  }

  console.log(`Matches: ${updated} updated, ${unmatched} provider fixtures had no DB counterpart yet.`);
  return { newlyFinished };
}

// ----------------------------------------------------------------------------
// Step 4: score newly-finished matches
// ----------------------------------------------------------------------------

async function scoreFinishedMatch(supabase: SupabaseClient<Database>, match: DbMatchRow) {
  const { data: fresh, error: freshErr } = await supabase
    .from("matches")
    .select("home_score, away_score")
    .eq("id", match.id)
    .single();
  if (freshErr || fresh.home_score === null || fresh.away_score === null) return;

  const { data: predictions, error: predErr } = await supabase
    .from("match_predictions")
    .select("id, predicted_home, predicted_away")
    .eq("match_id", match.id);
  if (predErr) {
    console.error(`  ✗ Loading predictions for match #${match.match_number}: ${predErr.message}`);
    return;
  }
  if (!predictions || predictions.length === 0) return;

  console.log(
    `  Scoring ${predictions.length} prediction(s) for match #${match.match_number} (final ${fresh.home_score}-${fresh.away_score}) …`
  );

  for (const p of predictions) {
    const { points, breakdown } = scoreMatchPrediction({
      predictedHome: p.predicted_home,
      predictedAway: p.predicted_away,
      actualHome: fresh.home_score,
      actualAway: fresh.away_score,
    });

    const { error: scoreErr } = await supabase
      .from("match_predictions")
      .update({ points_awarded: points, score_breakdown: breakdown })
      .eq("id", p.id);

    if (scoreErr) console.error(`    ✗ Prediction ${p.id}: ${scoreErr.message}`);
  }
}

// ----------------------------------------------------------------------------
// Step 5a: standings
// ----------------------------------------------------------------------------

async function syncStandings(supabase: SupabaseClient<Database>) {
  console.log("Fetching standings …");
  let groups;
  try {
    groups = await fetchStandings();
  } catch (err) {
    console.error(`  ! Standings fetch failed (often unavailable before the group stage starts): ${(err as Error).message}`);
    return;
  }

  const { data: dbTeams, error: teamsErr } = await supabase.from("teams").select("id, name, is_placeholder");
  if (teamsErr) throw teamsErr;
  const teamsByName = new Map<string, DbTeamRow>(
    (dbTeams as DbTeamRow[]).filter((t) => !t.is_placeholder).map((t) => [t.name.trim().toLowerCase(), t])
  );

  let written = 0;
  for (const group of groups) {
    const groupLetter = groupLetterFromProviderGroup(group.group);
    if (!groupLetter) continue; // skip overall/knockout tables — we only track group standings

    for (const row of group.table) {
      let team = teamsByName.get(row.team.name.trim().toLowerCase());
      if (!team) {
        for (const t of teamsByName.values()) {
          if (namesLikelyMatch(t.name, row.team.name)) {
            team = t;
            break;
          }
        }
      }
      if (!team) {
        console.warn(`  ! Standings: no DB team match for "${row.team.name}" (Group ${groupLetter}) — skipping row`);
        continue;
      }

      const { error } = await supabase.from("standings").upsert(
        {
          group_letter: groupLetter,
          team_id: team.id,
          played: row.playedGames,
          won: row.won,
          drawn: row.draw,
          lost: row.lost,
          goals_for: row.goalsFor,
          goals_against: row.goalsAgainst,
          points: row.points,
          rank: row.position,
        },
        { onConflict: "group_letter,team_id" }
      );

      if (error) console.error(`  ✗ Standing for ${row.team.name}: ${error.message}`);
      else written++;
    }
  }
  console.log(`Standings: ${written} rows upserted.`);
}

// ----------------------------------------------------------------------------
// Step 5b: top scorers (best effort — see provider caveat)
// ESPN internal API is used as a fallback when football-data.org returns empty.
// The ESPN endpoint is undocumented but stable; it begins returning data once
// matches are played. Both sources normalise to the same flat shape before
// being written.
// ----------------------------------------------------------------------------

interface NormalisedScorer { name: string; teamName: string; goals: number; assists: number }

async function fetchScorersFromESPN(): Promise<NormalisedScorer[]> {
  const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/statistics?view=scoring&limit=50&season=2026";
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await resp.json() as any;
    const entries: Array<{ athlete?: { displayName?: string }; team?: { displayName?: string }; statistics?: Array<{ name: string; displayValue: string }> }> =
      json?.leaders ?? json?.statistics?.athletes ?? [];
    if (!Array.isArray(entries) || !entries.length) return [];

    return entries
      .map((e) => {
        const stat = (name: string) =>
          Number(e.statistics?.find((s) => s.name === name)?.displayValue ?? 0) || 0;
        const goals = stat("goals") || stat("totalGoals") || stat("goalsScoredByFoot");
        const assists = stat("goalAssists") || stat("assists");
        return {
          name: e.athlete?.displayName ?? "",
          teamName: e.team?.displayName ?? "",
          goals,
          assists,
        };
      })
      .filter((e) => e.name.length > 0);
  } catch {
    return [];
  }
}

async function syncTopScorers(supabase: SupabaseClient<Database>) {
  console.log("Fetching top scorers …");

  let scorers: NormalisedScorer[] = [];

  // Primary: football-data.org
  try {
    const raw = await fetchScorers();
    if (raw?.length) {
      scorers = raw.map((s) => ({
        name: s.player.name,
        teamName: s.team.name,
        goals: s.goals,
        assists: s.assists ?? 0,
      }));
      console.log(`  football-data.org: ${scorers.length} scorers.`);
    }
  } catch (err) {
    console.warn(`  ! football-data.org scorers failed: ${(err as Error).message}`);
  }

  // Fallback: ESPN internal API
  if (!scorers.length) {
    scorers = await fetchScorersFromESPN();
    if (scorers.length) {
      console.log(`  ESPN fallback: ${scorers.length} scorers.`);
    } else {
      console.log("  No scorer data yet from either source.");
      return;
    }
  }

  const { data: dbTeams, error: teamsErr } = await supabase.from("teams").select("id, name, is_placeholder");
  if (teamsErr) throw teamsErr;
  const teamsByName = new Map<string, DbTeamRow>(
    (dbTeams as DbTeamRow[]).filter((t) => !t.is_placeholder).map((t) => [t.name.trim().toLowerCase(), t])
  );

  scorers.sort((a, b) => b.goals - a.goals || b.assists - a.assists);

  // Clear stale rows before re-writing: the provider may return fewer than
  // the previous set (e.g. corrected data), and we want the table to always
  // reflect exactly what the provider currently says, ranked from scratch.
  await supabase.from("top_scorers").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  let written = 0;
  for (let i = 0; i < scorers.length; i++) {
    const s = scorers[i];
    let team = teamsByName.get(s.teamName.trim().toLowerCase());
    if (!team) {
      for (const t of teamsByName.values()) {
        if (namesLikelyMatch(t.name, s.teamName)) {
          team = t;
          break;
        }
      }
    }

    const { error } = await supabase.from("top_scorers").upsert(
      {
        player_name: s.name,
        player_id: null,
        team_id: team?.id ?? null,
        goals: s.goals,
        assists: s.assists,
        rank: i + 1,
      },
      { onConflict: "player_name" }
    );

    if (error) console.error(`  ✗ Scorer ${s.name}: ${error.message}`);
    else written++;
  }
  console.log(`Scorers: ${written} rows upserted.`);
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

export async function runSync(): Promise<{ ok: boolean; message: string; finishedScored: number }> {
  const supabase = getServiceRoleClient();

  try {
    const { newlyFinished } = await syncMatches(supabase);

    if (newlyFinished.length > 0) {
      console.log(`Scoring ${newlyFinished.length} newly-finished match(es) …`);
      await Promise.all(newlyFinished.map((m) => scoreFinishedMatch(supabase, m)));
    }

    await syncStandings(supabase);
    await syncTopScorers(supabase);

    const msg = `Sync complete. ${newlyFinished.length} match(es) newly scored.`;
    console.log(msg);
    return { ok: true, message: msg, finishedScored: newlyFinished.length };
  } catch (err) {
    const msg = `Sync failed: ${(err as Error).message}`;
    console.error(msg);
    return { ok: false, message: msg, finishedScored: 0 };
  }
}
