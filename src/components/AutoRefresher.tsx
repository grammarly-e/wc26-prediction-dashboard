"use client";

// ============================================================================
// Invisible client component: periodically re-fetches the current Server
// Component tree so the dashboard reflects new data without a manual reload.
//
// Why polling instead of Supabase Realtime: Realtime would technically work,
// but it requires an extra manual step most people miss — enabling table
// replication in the Supabase dashboard (Database > Replication) for each
// watched table — and it adds a websocket subscription lifecycle to debug if
// something looks stale. None of that buys anything here: the underlying data
// only changes when the sync job runs (scripts/sync-live-data.ts via the
// /api/sync route — triggered by GitHub Actions every 3 hours and Vercel Cron
// once daily as a backstop; see .github/workflows/sync.yml, vercel.json, and
// SETUP_AND_VERIFY.md). Polling every 30 seconds means the page always shows
// the latest synced data within half a minute of a sync completing — there's
// no reason to poll less often just because syncs themselves are infrequent.
//
// `router.refresh()` re-runs the Server Component data fetch (see the
// `revalidate = 0` pages under src/app/**), so the rendered HTML always
// reflects the latest row in Supabase — no client-side state duplication.
//
// Mount this once near the root (see src/app/layout.tsx).
// ============================================================================

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_INTERVAL_MS = 30_000;

export default function AutoRefresher() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
