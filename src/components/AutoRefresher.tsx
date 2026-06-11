"use client";

// ============================================================================
// Invisible client component with two jobs:
//
// 1. Periodic UI refresh (every 30 s) — calls router.refresh() so the page
//    always shows the latest data from Supabase within half a minute of a
//    sync completing, without a full page reload.
//
// 2. Staleness guard (once on mount) — calls /api/auto-sync, which checks
//    whether the match data is older than 24 hours and triggers a full sync
//    if so. This is a safety net for the primary hourly schedule (GitHub
//    Actions, .github/workflows/sync.yml) and the daily Vercel Cron backstop
//    (vercel.json). If both fail, the first page visitor that day still gets
//    a sync kicked off automatically.
//
// Why polling instead of Supabase Realtime: Realtime requires manually
// enabling table replication in the Supabase dashboard for each table and
// adds a websocket lifecycle to debug. Polling every 30 seconds achieves
// the same practical result with no extra setup.
//
// `router.refresh()` re-runs Server Component data fetches (pages marked
// `revalidate = 0`), so the HTML always reflects current Supabase state.
//
// Mount this once near the root (src/app/layout.tsx).
// ============================================================================

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_INTERVAL_MS = 30_000;

export default function AutoRefresher() {
  const router = useRouter();

  // One-time staleness check on mount — fires a sync if data is >24h old.
  useEffect(() => {
    fetch("/api/auto-sync").catch(() => {}); // fire-and-forget; errors are non-fatal
  }, []);

  // Periodic UI refresh so the page reflects newly-synced data quickly.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
