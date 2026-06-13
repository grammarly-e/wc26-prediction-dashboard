"use client";

// ============================================================================
// Invisible client component — keeps the page in sync with live data.
//
// Two loops, both adaptive:
//
// SYNC LOOP (calls /api/auto-sync):
//   - Live match in progress   → every 60 s  (endpoint syncs external APIs)
//   - Post-match window        → every 90 s  (catches final score + events)
//   - Idle                     → every 5 min (safety net; GitHub Actions cron
//                                             covers the real hourly refresh)
//
// UI REFRESH LOOP (calls router.refresh — re-reads Supabase, no external API):
//   - Live or post-match       → every 15 s  (shows score changes quickly)
//   - Idle                     → every 60 s  (low noise when nothing is live)
//
// The /api/auto-sync endpoint is itself rate-limited: it checks the last
// sync timestamp and skips if the data is already fresh, so many concurrent
// users don't cause redundant API calls.
// ============================================================================

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type MatchWindow = "live" | "post_match" | "idle";

const SYNC_INTERVALS: Record<MatchWindow, number> = {
  live:       60_000,   // 60 s
  post_match: 90_000,   // 90 s
  idle:       5 * 60_000, // 5 min
};

const REFRESH_INTERVALS: Record<MatchWindow, number> = {
  live:       15_000,  // 15 s
  post_match: 15_000,  // 15 s
  idle:       60_000,  // 60 s
};

export default function AutoRefresher() {
  const router = useRouter();
  const [window_, setWindow] = useState<MatchWindow>("idle");
  const syncTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callAutoSync = useCallback(async (): Promise<MatchWindow> => {
    try {
      const res = await fetch("/api/auto-sync");
      if (!res.ok) return "idle";
      const body = await res.json() as { reason?: string };
      const r = body.reason ?? "idle";
      if (r === "live_match") return "live";
      if (r === "post_match") return "post_match";
      return "idle";
    } catch {
      return "idle";
    }
  }, []);

  // Schedule the next sync call and UI refresh based on the current window.
  const schedule = useCallback((win: MatchWindow) => {
    if (syncTimerRef.current)    clearTimeout(syncTimerRef.current);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    // UI refresh loop (re-reads DB, no external API call)
    const scheduleRefresh = () => {
      refreshTimerRef.current = setTimeout(() => {
        router.refresh();
        scheduleRefresh();
      }, REFRESH_INTERVALS[win]);
    };
    scheduleRefresh();

    // Sync loop (may call external API if data is stale)
    const scheduleSync = () => {
      syncTimerRef.current = setTimeout(async () => {
        const nextWin = await callAutoSync();
        if (nextWin !== win) {
          // Window changed — reschedule everything with new intervals
          setWindow(nextWin);
          schedule(nextWin);
        } else {
          scheduleSync();
        }
      }, SYNC_INTERVALS[win]);
    };
    scheduleSync();
  }, [router, callAutoSync]);

  useEffect(() => {
    // Kick off immediately on mount, then let the loops take over.
    callAutoSync().then((win) => {
      setWindow(win);
      schedule(win);
      router.refresh();
    });

    return () => {
      if (syncTimerRef.current)    clearTimeout(syncTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [callAutoSync, schedule, router]);

  return null;
}
