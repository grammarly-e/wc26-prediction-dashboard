// ============================================================================
// Resets the test database to its clean post-migration state — removes all
// participants (and their predictions via cascade), and resets any fake match
// results back to "scheduled". Run this when you're done testing and want a
// fresh start for the next demo round.
//
// SAFETY — same two guards as seed-test-data.ts:
//   1. Loads only .env.test.local, never .env.local.
//   2. Compares the URL in .env.test.local against the URL in .env.local and
//      refuses to continue if they're the same.
//   3. Only resets matches where external_id IS NULL — rows synced from the
//      live feed always have an external_id, so this cannot touch real results.
//
// Run with: npm run clear:test
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_ENV_PATH = resolve(process.cwd(), ".env.test.local");
const PROD_ENV_PATH = resolve(process.cwd(), ".env.local");

if (!existsSync(TEST_ENV_PATH)) {
  console.error(
    "Missing .env.test.local — nothing to clear. See TESTING_ENVIRONMENT.md."
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

// --- Guard: refuse to run against the production project. ---
if (existsSync(PROD_ENV_PATH)) {
  const prodEnv = dotenv.parse(readFileSync(PROD_ENV_PATH, "utf-8"));
  if (prodEnv.NEXT_PUBLIC_SUPABASE_URL && prodEnv.NEXT_PUBLIC_SUPABASE_URL === SUPABASE_URL) {
    console.error(
      "\n🛑 REFUSING TO RUN.\n\n" +
        ".env.test.local points at the SAME Supabase project as .env.local (production).\n" +
        "This script deletes all participants and resets match statuses — running it against\n" +
        "production would irreversibly delete real data. Use a separate Supabase project for\n" +
        "testing. See TESTING_ENVIRONMENT.md.\n"
    );
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log(`Clearing test data from ${SUPABASE_URL}\n`);

  // 1. Delete all participants (cascades to match_predictions). ----------------
  // This is safe because the entire participants table in the test project
  // consists of people who joined during testing. The production URL guard
  // above ensures we never run this against real data.
  console.log("Deleting all participants (+ their predictions via cascade)…");
  const { data: deleted, error: delErr } = await supabase
    .from("participants")
    .delete()
    .not("display_name", "is", null) // Supabase requires a filter; this matches all rows
    .select("display_name");
  if (delErr) {
    console.error(`  x ${delErr.message}`);
  } else {
    const names = (deleted ?? []).map((r: { display_name: string }) => r.display_name);
    console.log(`  Removed ${names.length} participant(s)${names.length > 0 ? `: ${names.join(", ")}` : ""}`);
  }
  console.log("");

  // 2. Reset fake match results back to scheduled. ----------------------------
  // The external_id IS NULL filter is the critical safety mechanism: every
  // match synced from football-data.org has an external_id. The seed script
  // never sets external_id, so this query cannot touch a real synced result
  // even if (despite every other guard) it somehow ran against production.
  console.log("Resetting fake match results back to 'scheduled'…");
  const { data: reset, error: resetErr } = await supabase
    .from("matches")
    .update({ home_score: null, away_score: null, status: "scheduled" })
    .eq("status", "finished")
    .is("external_id", null)
    .select("match_number");
  if (resetErr) {
    console.error(`  x ${resetErr.message}`);
  } else {
    const nums = (reset ?? []).map((r: { match_number: number }) => `#${r.match_number}`);
    console.log(`  Reset ${nums.length} match(es)${nums.length > 0 ? `: ${nums.join(", ")}` : ""}`);
  }
  console.log("");

  console.log("Done. The test database is back to its clean state.");
  console.log("  → npm run dev:test to start a fresh demo round.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
