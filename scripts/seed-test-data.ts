// ============================================================================
// Simulates match results in an ISOLATED TEST Supabase project — marks the
// first N matches as "finished" with randomly generated scorelines, then
// scores any predictions that real participants have already submitted for
// those matches.
//
// The typical test workflow is:
//   1. npm run dev:test     — start the dev server (localhost:3001)
//   2. Join via the UI, submit your predictions for upcoming matches
//   3. npm run seed:test    — "play out" those matches and score your picks
//   4. Refresh the leaderboard and prediction breakdown to see results
//   5. npm run clear:test   — reset everything when you're done
//
// SAFETY — three independent guards:
//   1. Loads .env.test.local, never .env.local (production's file).
//   2. Refuses to run if .env.test.local's Supabase URL matches .env.local's —
//      i.e. if the "test" file points at the real project by accident or typo.
//   3. Only marks matches with external_id IS NULL as finished — every match
//      synced from the live feed has an external_id, so even if this script
//      somehow ran against production it could not overwrite real results.
//
// Run with: npm run seed:test
// Requires: a separate Supabase project, schema migrated + seeded the same
// way as production (see TESTING_ENVIRONMENT.md), and its credentials in
// .env.test.local (copy .env.test.local.example).
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { scoreMatchPrediction } from "../src/lib/scoring";

const TEST_ENV_PATH = resolve(process.cwd(), ".env.test.local");
const PROD_ENV_PATH = resolve(process.cwd(), ".env.local");

if (!existsSync(TEST_ENV_PATH)) {
  console.error(
    "Missing .env.test.local — copy .env.test.local.example, fill in a SEPARATE Supabase " +
      "project's credentials, and try again. Full steps: TESTING_ENVIRONMENT.md"
  );
  process.exit(1);
}

dotenv.config({ path: TEST_ENV_PATH });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.test.local.");
  process.exit(1);
}

// --- Guard #2: refuse to run if the test file points at the production project. ---
if (existsSync(PROD_ENV_PATH)) {
  const prodEnv = dotenv.parse(readFileSync(PROD_ENV_PATH, "utf-8"));
  if (prodEnv.NEXT_PUBLIC_SUPABASE_URL && prodEnv.NEXT_PUBLIC_SUPABASE_URL === SUPABASE_URL) {
    console.error(
      "\n🛑 REFUSING TO RUN.\n\n" +
        ".env.test.local points at the SAME Supabase project as .env.local (production).\n" +
        "This script overwrites match results and scores predictions directly in the database\n" +
        "— running it here would corrupt the real leaderboard for everyone. Create a separate\n" +
        "(free-tier) Supabase project for testing and point .env.test.local at THAT project's\n" +
        "credentials instead. See TESTING_ENVIRONMENT.md.\n"
    );
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// How many of the earliest-kickoff matches to "play out" with fake final scores.
// Eight is enough to make the leaderboard, the group/knockout stage split, the
// color-coded breakdown, and the match-insight callouts all render meaningfully.
const MATCHES_TO_SIMULATE = 8;

function randomGoals(): number {
  // Skewed toward low scorelines (0–3), like real football.
  return Math.floor(Math.random() ** 1.6 * 5);
}

async function main() {
  console.log(`Simulating results in ${SUPABASE_URL}\n`);

  // 1. Fetch the earliest matches (by kickoff order) ---------------------------
  console.log(`Marking the first ${MATCHES_TO_SIMULATE} matches as finished…`);
  const { data: matches, error: matchesErr } = await supabase
    .from("matches")
    .select("id, match_number, team1_code, team2_code")
    .is("external_id", null) // never touch rows synced from the live feed
    .order("kickoff_at", { ascending: true })
    .limit(MATCHES_TO_SIMULATE);
  if (matchesErr) throw matchesErr;
  if (!matches || matches.length === 0) {
    console.error(
      "No matches found. Run migrations + npm run seed against the TEST project first.\n" +
        "See TESTING_ENVIRONMENT.md."
    );
    process.exit(1);
  }

  // 2. Generate random scores and mark each match as finished ------------------
  const fakeResults = new Map<string, { home: number; away: number }>();
  for (const m of matches) {
    const home = randomGoals();
    const away = randomGoals();
    fakeResults.set(m.id, { home, away });
    const { error } = await supabase
      .from("matches")
      .update({ home_score: home, away_score: away, status: "finished" })
      .eq("id", m.id);
    if (error) console.error(`  x Match #${m.match_number}: ${error.message}`);
    else console.log(`  Match #${m.match_number} (${m.team1_code} vs ${m.team2_code}) → ${home}–${away}`);
  }
  console.log("");

  // 3. Score any predictions that participants have already submitted -----------
  // This is what lets real participants see their actual picks evaluated against
  // the fake results. Any match_prediction rows that exist for these matches get
  // their points_awarded and score_breakdown filled in here.
  console.log("Scoring existing predictions…");
  const matchIds = matches.map((m) => m.id);
  const { data: preds, error: predsErr } = await supabase
    .from("match_predictions")
    .select("id, match_id, predicted_home, predicted_away")
    .in("match_id", matchIds);
  if (predsErr) throw predsErr;

  let scored = 0;
  for (const pred of (preds ?? []) as Array<{
    id: string;
    match_id: string;
    predicted_home: number;
    predicted_away: number;
  }>) {
    const actual = fakeResults.get(pred.match_id);
    if (!actual) continue;

    const { points, breakdown } = scoreMatchPrediction({
      predictedHome: pred.predicted_home,
      predictedAway: pred.predicted_away,
      actualHome: actual.home,
      actualAway: actual.away,
    });

    const { error } = await supabase
      .from("match_predictions")
      .update({ points_awarded: points, score_breakdown: breakdown })
      .eq("id", pred.id);
    if (error) console.error(`  x ${pred.id}: ${error.message}`);
    else scored++;
  }

  if (scored > 0) {
    console.log(`  ${scored} prediction(s) scored.`);
  } else {
    console.log("  No predictions found for these matches yet — submit your picks first, then re-run.");
  }
  console.log("");

  console.log("Done.");
  console.log("  → Refresh the leaderboard and click your name to see the prediction breakdown.");
  console.log("  → npm run clear:test when you're ready to reset.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
