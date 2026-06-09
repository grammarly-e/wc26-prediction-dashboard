# Testing Environment

A fully isolated sandbox for demoing the dashboard with real participant input and fake match results, so you can show the leaderboard, color-coded prediction breakdown, and match-insight callouts all working — without any of it touching the real database.

---

## How it stays isolated from production

There are three independent layers of separation, not one:

**Layer 1 — separate Supabase project.** All test scripts (`seed:test`, `clear:test`, `dev:test`) read credentials from `.env.test.local`, not `.env.local`. They write to a completely different database that you own and can delete at any time.

**Layer 2 — URL equality guard.** Every test script compares the Supabase URL in `.env.test.local` against the one in `.env.local` at startup. If they match — whether by accident or by intent — the script immediately prints a loud refusal message and exits. Nothing is written.

**Layer 3 — `external_id IS NULL` filter on rollback.** The seed and clear scripts only touch match rows where `external_id IS NULL`. Every match synced from the live football-data.org feed has an external_id. The fake results written by the seed script never set external_id. So even if either script somehow ran against production, it could not touch a row that holds a real result.

**The git side.** All test-only files live on the `testing-sandbox` branch and are never merged to `main`. To "revert" the website you simply stay on `main` (or `git checkout main`). You don't need to undo anything — main has never seen these files.

---

## One-time setup

### Step 1 — Create a separate Supabase project

Go to <https://supabase.com/dashboard>, click **New project**, and give it a name like "WC2026 Test". Free tier is fine. Wait for it to provision (~1 min).

### Step 2 — Run migrations on the test project

In your test project's dashboard: **SQL Editor → New query**. Run the migration SQL files in order — they're numbered, run each one as a separate query:

```
supabase/migrations/0001_init_schema.sql
supabase/migrations/0002_row_level_security.sql
supabase/migrations/0003_resolve_playoff_slots.sql
```

This creates all the tables (`matches`, `teams`, `participants`, `match_predictions`, etc.).

Then run the prediction categories seed — this populates the `prediction_categories` table that the predictions page reads. Without it the predictions UI will error:

```
supabase/seed/prediction_categories.sql
```

### Step 3 — Seed the fixture schedule into the test project

`npm run seed` reads from `.env.local` (the production project), so run it with env vars overridden to point at the test project instead:

```bash
# On macOS/Linux:
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-TEST-REF.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-test-service-role-key \
tsx scripts/seed.ts

# On Windows (PowerShell):
$env:NEXT_PUBLIC_SUPABASE_URL="https://YOUR-TEST-REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-test-service-role-key"
npx tsx scripts/seed.ts
```

This inserts the 104-match schedule and all team rows. Run it once per test project.

### Step 4 — Create `.env.test.local`

```bash
cp .env.test.local.example .env.test.local
```

Open `.env.test.local` and fill in the three values from your test project's **Project Settings → API** page:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-TEST-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-test-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-test-service-role-key
```

This file is already git-ignored (`.gitignore` matches `.env*.local`). Do not commit it.

---

## Using the testing environment

The test workflow is designed so participants input their own predictions — nothing is auto-generated. The seed script only simulates the match results after you've submitted your picks.

### Step 1 — Start the test dev server

```bash
npm run dev:test
```

Opens the dashboard at **`http://localhost:3001`** (port 3001, not 3000 — you can keep the real dev server running on 3000 simultaneously without conflict). The server talks to the test Supabase project only.

### Step 2 — Join and submit predictions

Go to `http://localhost:3001` in your browser. Have everyone who's participating join with a display name and submit their predictions for the upcoming matches. The first 8 matches by kickoff order are the ones that will be scored.

You can have multiple people join from different browsers or different devices — they'll all go into the same test database.

### Step 3 — Simulate match results

```bash
npm run seed:test
```

This marks the **8 earliest matches** as finished with randomly generated scores (low-goal skewed, like real football), then immediately scores every prediction that has been submitted for those matches.

The output shows each match's fake scoreline as it's inserted, followed by how many predictions were scored.

Run this after everyone has submitted their picks. You can re-run it to generate a fresh set of results (scores will be re-randomized and predictions re-scored).

### Step 4 — Check the leaderboard

Refresh the browser. Everything in the UI should now be live: the leaderboard with ranks and exact-score tallies, the color-coded prediction breakdown per participant (gold for exact, green for right result, red for wrong), the "Biggest Upset" and "Best Read" callouts on the Matches page, and the Stage Leader cards on the Leaderboard page.

### Step 5 — Clear test data when done

```bash
npm run clear:test
```

Deletes all participants (and their predictions) and resets the 8 fake match results back to `scheduled`. The test database is left in the same state it was in right after seeding the fixture schedule.

You can run the cycle (`dev:test` → join → `seed:test` → `clear:test`) as many times as you want.

---

## Reverting to the real website

There is nothing to revert in the production database — the test scripts never touch it.

On the git side:

```bash
git checkout main
```

`main` has no test scripts, no `.env.test.local`, and no reference to any of this. The production website is exactly as it was.

If you want to permanently discard the test branch:

```bash
git branch -d testing-sandbox
```

(Or just leave it — it will never be merged unless you explicitly do so.)

---

## Summary of test-only files (all on `testing-sandbox` branch only)

| File | Purpose |
|---|---|
| `.env.test.local.example` | Template — copy to `.env.test.local` and fill in test project credentials |
| `.env.test.local` | **You create this** by copying the example (git-ignored, never committed) |
| `scripts/seed-test-data.ts` | Marks the first 8 matches as finished with random scores; scores existing predictions |
| `scripts/clear-test-data.ts` | Removes all participants + predictions, resets match results to clean state |
| `scripts/dev-test.ts` | Starts Next.js on port 3001 pointed at the test project |
| `TESTING_ENVIRONMENT.md` | This file |

`package.json` on this branch adds three scripts: `seed:test`, `clear:test`, `dev:test`.
