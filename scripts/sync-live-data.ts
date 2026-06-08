// ============================================================================
// CLI entry point for the live-data sync — run with `npm run sync`.
//
// All the actual logic lives in src/lib/sync.ts (shared with the /api/sync
// route that Vercel Cron calls in production — see vercel.json). This file's
// only job is to do the things a CLI needs that an API route must NOT do:
// load .env.local from disk, and call process.exit() with a real exit code.
// ============================================================================

import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

// Note on ordering: TS/ESM hoists this import above the dotenv.config() call
// below, but that's fine — runSync() only reads process.env lazily, inside
// its own function body, when it's actually called (see getServiceRoleClient
// in src/lib/sync.ts). By the time `.then()` below fires, dotenv.config() has
// already run and populated process.env.
import { runSync } from "../src/lib/sync";

runSync()
  .then((result) => {
    console.log(`Done. ${result.finishedScored} newly-finished match(es) scored.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
