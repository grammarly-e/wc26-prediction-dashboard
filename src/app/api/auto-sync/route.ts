// ============================================================================
// GET /api/auto-sync — staleness-guarded sync trigger, no auth required.
//
// Called periodically by AutoRefresher. Checks whether a sync is needed
// before hitting any external APIs, so hammering this endpoint is safe.
//
// Thresholds:
//   - Any match is live                → sync if data is > 60 s old
//   - A match finished within 15 min  → sync if data is > 90 s old
//   - No active match window           → sync if data is > 24 h old
//
// The short thresholds ensure scores and match events are reflected within
// ~a minute of them changing, without burning unnecessary API calls during
// the ~22 hours per day when nothing is happening.
// ============================================================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIVE_THRESHOLD_MS        =  60 * 1_000;  //  60 seconds
const POST_MATCH_THRESHOLD_MS  =  90 * 1_000;  //  90 seconds
const IDLE_THRESHOLD_MS        = 24 * 3_600 * 1_000; // 24 hours
const POST_MATCH_WINDOW_MS     = 15 * 60 * 1_000;    // 15 minutes

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    // --- Determine the appropriate staleness threshold --------------------
    const { data: matches } = await supabase
      .from("matches")
      .select("status, updated_at, away_score")
      .in("status", ["live", "finished"])
      .order("updated_at", { ascending: false })
      .limit(20);

    const now = Date.now();
    let threshold = IDLE_THRESHOLD_MS;
    let reason = "idle";

    if (matches?.length) {
      const hasLive = matches.some((m) => m.status === "live");
      const hasRecentFinish = matches.some(
        (m) => m.status === "finished" && now - new Date(m.updated_at).getTime() <= POST_MATCH_WINDOW_MS
      );

      if (hasLive) {
        threshold = LIVE_THRESHOLD_MS;
        reason = "live_match";
      } else if (hasRecentFinish) {
        threshold = POST_MATCH_THRESHOLD_MS;
        reason = "post_match";
      }
    }

    // --- Check last sync time --------------------------------------------
    const { data: latest } = await supabase
      .from("matches")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastSyncedAt = latest?.updated_at ?? null;

    if (lastSyncedAt) {
      const ageMs = now - new Date(lastSyncedAt).getTime();
      if (ageMs < threshold) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason,
          lastSyncedAt,
          ageMs,
          thresholdMs: threshold,
        });
      }
    }

    const result = await runSync();
    return NextResponse.json({ skipped: false, triggered: true, reason, ...result });
  } catch (err) {
    console.error("[auto-sync] failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
