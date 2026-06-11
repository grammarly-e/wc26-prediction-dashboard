// ============================================================================
// GET /api/auto-sync — staleness-guarded sync trigger, no auth required.
//
// Called once on page load by AutoRefresher. If the most recently updated match
// row is older than STALE_THRESHOLD_MS (24 h), this runs a full sync so that
// visitors always see reasonably fresh data even if GitHub Actions has been
// down or slow.
//
// No secret required because the endpoint self-rate-limits: it checks
// last_synced_at before doing anything and skips the sync if data is fresh.
// Concurrent calls during the same stale window are safe — football-data.org
// allows 10 req/min and a full sync uses 3 calls, well within that.
// ============================================================================

import { NextResponse } from "next/server";

import { getLastSyncedAt } from "@/lib/data";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET() {
  try {
    const lastSyncedAt = await getLastSyncedAt();

    if (lastSyncedAt) {
      const ageMs = Date.now() - new Date(lastSyncedAt).getTime();
      if (ageMs < STALE_THRESHOLD_MS) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "recently_synced",
          lastSyncedAt,
          ageHours: Math.round(ageMs / 3_600_000),
        });
      }
    }

    const result = await runSync();
    return NextResponse.json({ skipped: false, triggered: true, ...result });
  } catch (err) {
    console.error("[auto-sync] failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
