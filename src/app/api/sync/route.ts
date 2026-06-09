// ============================================================================
// POST /api/sync — triggers the live-data sync job over HTTP.
//
// Why this exists: the sync logic in src/lib/sync.ts (shared with the
// `npm run sync` CLI in scripts/sync-live-data.ts) needs to run on a
// recurring schedule once the tournament starts, and Vercel's hosting model
// doesn't support long-lived background processes — only request-driven
// functions and Vercel Cron (which calls HTTP endpoints on a schedule).
// This route is that endpoint.
//
// Auth: protected by a shared-secret header, NOT Supabase auth — schedulers
// can't carry a user session. Set SYNC_SECRET in your environment. Anyone
// with the secret can trigger a sync; that's an acceptable risk (it only
// re-fetches public sports data) but keep the secret out of client code and
// version control.
//
// Two schedulers call this route, on purpose:
//
//   1. Vercel Cron (vercel.json, project root) — runs once a day:
//        { "crons": [{ "path": "/api/sync", "schedule": "0 5 * * *" }] }
//      This is the maximum frequency the Vercel Hobby plan allows; a more
//      frequent expression (e.g. */10 * * * *) fails to deploy outright with
//      "Hobby accounts are limited to daily cron jobs" — that was silently
//      breaking every deploy and burning the daily deployment quota.
//
//   2. GitHub Actions (.github/workflows/sync.yml) — runs every 3 hours and
//      hits this same endpoint with the `x-sync-secret` header. GitHub's
//      scheduler has no such frequency limit, so this is how the app gets
//      its real refresh cadence without needing a paid Vercel plan. Requires
//      two repo secrets: SYNC_URL (e.g. https://your-app.vercel.app/api/sync)
//      and SYNC_SECRET (must match the value set in Vercel's environment
//      variables). See SETUP_AND_VERIFY.md.
//
// Vercel Cron sends GET requests with an Authorization: Bearer <CRON_SECRET>
// header automatically when CRON_SECRET is set — this route accepts either
// that or a manual `x-sync-secret` header so any scheduler (or a person, via
// `curl -X POST .../api/sync -H "x-sync-secret: ..."`) can trigger it.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";

import { runSync } from "@/lib/sync";

export const dynamic = "force-dynamic"; // never cache — this always hits live sources
export const maxDuration = 60; // seconds; sync makes a handful of sequential API calls

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    console.warn("SYNC_SECRET is not set — refusing all sync requests until it is configured.");
    return false;
  }

  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return true;

  const manual = req.headers.get("x-sync-secret");
  if (manual === secret) return true;

  return false;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSync();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Sync job failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// Accept both — Vercel Cron issues GET requests; manual/admin triggers use POST.
export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
