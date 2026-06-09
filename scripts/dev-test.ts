// ============================================================================
// Launches `next dev` on port 3001, pointing at the TEST Supabase project
// from .env.test.local — not .env.local (the production project).
//
// Why a script instead of `next dev -p 3001` directly?
// Next.js 14/15 loads .env*.local files itself, at process start, BEFORE any
// app-level dotenv call can run. If we pre-set the env vars here before
// spawning the Next process, Node's fork inherits them and Next's own loader
// sees the vars as already-set — it won't overwrite them, so the test project
// credentials win. Without this wrapper, Next would always load .env.local
// (production) regardless of which env file you wanted.
//
// Run with: npm run dev:test
// ============================================================================

import { config as loadEnv, parse as parseEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const TEST_ENV_PATH = resolve(process.cwd(), ".env.test.local");
const PROD_ENV_PATH = resolve(process.cwd(), ".env.local");

if (!existsSync(TEST_ENV_PATH)) {
  console.error(
    "Missing .env.test.local — copy .env.test.local.example, fill in your TEST project's " +
      "credentials, then try again. See TESTING_ENVIRONMENT.md for the full walkthrough."
  );
  process.exit(1);
}

// Load test env into the *current* process so the spawned child inherits it.
loadEnv({ path: TEST_ENV_PATH });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is missing in .env.test.local.");
  process.exit(1);
}

// --- Guard: refuse to boot a dev server that silently points at production. ---
if (existsSync(PROD_ENV_PATH)) {
  const prodEnv = parseEnv(readFileSync(PROD_ENV_PATH, "utf-8"));
  if (prodEnv.NEXT_PUBLIC_SUPABASE_URL && prodEnv.NEXT_PUBLIC_SUPABASE_URL === SUPABASE_URL) {
    console.error(
      "\n🛑 REFUSING TO START.\n\n" +
        ".env.test.local points at the SAME Supabase project as .env.local (production).\n" +
        "A test dev server pointing at production would let fake participants + fake scored\n" +
        "predictions leak into the real leaderboard. Use a separate Supabase project for " +
        "testing — see TESTING_ENVIRONMENT.md.\n"
    );
    process.exit(1);
  }
}

console.log(`Starting test dev server on http://localhost:3001`);
console.log(`  Supabase: ${SUPABASE_URL}`);
console.log("  (Ctrl+C to stop)\n");

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "dev", "--port", "3001"],
  {
    // The current process already has all the test env vars loaded above, so
    // process.env here is the merged set. Pass it to the child wholesale.
    env: process.env,
    stdio: "inherit",
    shell: false,
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

// Forward SIGINT (Ctrl+C) and SIGTERM to the child so it can shut down cleanly.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
