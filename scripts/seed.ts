// ============================================================================
// Seeds Supabase with the official 104-match World Cup 2026 schedule.
//
// Run with:  npm run seed
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (this script writes
// directly, bypassing RLS — never run it from the browser).
//
// Source data: data/fixtures-2026.json, derived from openfootball/worldcup.json
// (public domain — https://github.com/openfootball/worldcup.json). Group-stage
// matches that involve a not-yet-determined playoff slot (e.g. "UEFA Path D
// winner") are seeded as placeholder teams; the sync job resolves them to
// real teams once qualification finishes and the live-data provider reports
// the actual lineup.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local — see .env.local.example"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface RawMatch {
  num: number;
  round: string;
  matchday?: string;
  date: string;
  time: string;
  team1: string;
  team2: string;
  group?: string;
  ground: string;
}

interface RawFixtures {
  matches: RawMatch[];
}

// Map a venue name to its host city (the schedule lists venue names; the
// host city is what the UI groups/filters by).
const VENUE_TO_CITY: Record<string, string> = {
  "Mexico City": "Mexico City",
  "Guadalajara (Zapopan)": "Guadalajara",
  "Monterrey (Guadalupe)": "Monterrey",
  Toronto: "Toronto",
  Vancouver: "Vancouver",
  "San Francisco Bay Area (Santa Clara)": "San Francisco Bay Area",
  "Los Angeles (Inglewood)": "Los Angeles",
  Seattle: "Seattle",
  "New York/New Jersey (East Rutherford)": "New York/New Jersey",
  "Boston (Foxborough)": "Boston",
  Philadelphia: "Philadelphia",
  "Miami (Miami Gardens)": "Miami",
  Atlanta: "Atlanta",
  Houston: "Houston",
  "Kansas City": "Kansas City",
  "Dallas (Arlington)": "Dallas",
};

// Round labels in the source data are split by matchday ("Matchday 1", etc.)
// — normalize them to the seven tournament rounds our schema expects.
function normalizeRound(round: string): string {
  if (round.startsWith("Matchday")) return "Group Stage";
  return round;
}

function isPlaceholderSlot(name: string): boolean {
  // Group-stage placeholders look like "UEFA Path D winner" / "IC Path 1 winner".
  // Knockout slot codes look like "1A", "2B", "3C/D/F/G/H", "W74", "L101".
  return (
    /\bwinner\b/i.test(name) ||
    /^[123]?[A-L](\/[A-L])*$/.test(name) ||
    /^[WL]\d+$/.test(name)
  );
}

// Parse "2026-06-11" + "13:00 UTC-6" into an ISO timestamp.
function parseKickoff(date: string, time: string): string {
  const match = time.match(/^(\d{2}):(\d{2})\s*UTC([+-]\d+)$/);
  if (!match) throw new Error(`Unrecognized time format: "${time}"`);
  const [, hh, mm, offset] = match;
  const offsetNum = parseInt(offset, 10);
  const sign = offsetNum >= 0 ? "+" : "-";
  const abs = Math.abs(offsetNum).toString().padStart(2, "0");
  return `${date}T${hh}:${mm}:00${sign}${abs}:00`;
}

async function upsertTeam(name: string): Promise<string> {
  const placeholder = isPlaceholderSlot(name);
  const { data: existing } = await supabase
    .from("teams")
    .select("id")
    .eq("name", name)
    .maybeSingle();

  if (existing) return existing.id as string;

  const { data, error } = await supabase
    .from("teams")
    .insert({ name, is_placeholder: placeholder })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

async function main() {
  console.log("Loading data/fixtures-2026.json …");
  const raw: RawFixtures = JSON.parse(
    readFileSync(resolve(process.cwd(), "data/fixtures-2026.json"), "utf-8")
  );

  console.log(`Found ${raw.matches.length} matches. Upserting teams + matches …`);

  const teamCache = new Map<string, string>();
  async function teamId(name: string): Promise<string | null> {
    if (isPlaceholderSlot(name) && /^[123]?[A-L](\/[A-L])*$/.test(name)) {
      // Pure knockout slot codes like "1A" or "3C/D/F" don't get a team row —
      // they're resolved to a real team_id once the group stage finishes.
      return null;
    }
    if (/^[WL]\d+$/.test(name)) return null; // "W74" / "L101" — winner/loser of another match

    if (teamCache.has(name)) return teamCache.get(name)!;
    const id = await upsertTeam(name);
    teamCache.set(name, id);
    return id;
  }

  let inserted = 0;
  let skipped = 0;

  for (const m of raw.matches) {
    const team1Id = await teamId(m.team1);
    const team2Id = await teamId(m.team2);

    // Assign group letters to teams when we know them.
    if (m.group && team1Id) {
      await supabase
        .from("teams")
        .update({ group_letter: m.group.replace("Group ", "") })
        .eq("id", team1Id)
        .is("group_letter", null);
    }
    if (m.group && team2Id) {
      await supabase
        .from("teams")
        .update({ group_letter: m.group.replace("Group ", "") })
        .eq("id", team2Id)
        .is("group_letter", null);
    }

    const row = {
      match_number: m.num,
      round: normalizeRound(m.round),
      matchday: m.round.startsWith("Matchday") ? m.round : null,
      group_letter: m.group ? m.group.replace("Group ", "") : null,
      kickoff_at: parseKickoff(m.date, m.time),
      venue: m.ground,
      host_city: VENUE_TO_CITY[m.ground] ?? m.ground,
      team1_code: m.team1,
      team2_code: m.team2,
      team1_id: team1Id,
      team2_id: team2Id,
      status: "scheduled" as const,
    };

    const { error } = await supabase
      .from("matches")
      .upsert(row, { onConflict: "match_number" });

    if (error) {
      console.error(`  ✗ Match #${m.num}: ${error.message}`);
      skipped++;
    } else {
      inserted++;
    }
  }

  console.log(`\nDone. ${inserted} matches upserted, ${skipped} failed.`);
  console.log(`${teamCache.size} real teams seeded (plus placeholder slots left unresolved).`);
  console.log(
    "\nNext: run the sync job (npm run sync) once you have a FOOTBALL_DATA_API_KEY — " +
      "it will resolve playoff-slot placeholders to real teams as qualification concludes, " +
      "and keep scores/standings/events updated live during the tournament."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
