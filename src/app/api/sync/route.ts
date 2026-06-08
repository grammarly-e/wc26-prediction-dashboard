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
// Auth: protected by a shared-secret header, NOT Supabase auth — Vercel Cron
// can't carry a user session. Set SYNC_SECRET in your environment and in
// vercel.json's cron config (see project root). Anyone with the secret can
// trigger a sync; that's an acceptable risk (it only re-fetches public sports
// data) but keep the secret out of client code and version control.
//
// Wire-up with Vercel Cron (vercel.json, already added at project root):
//   { "crons": [{ "path": "/api/sync", "schedule": "*/10 * * * *" }] }
// Vercel Cron sends GET requests with an Authorization: Bearer <CRON_SECRET>
// header automatically when CRON_SECRET is set — this route accepts either
// that or a manual `x-sync-secret` header so you can also trigger it by hand
// (e.g. `curl -X POST .../api/sync -H "x-sync-secret: ..."`) for testing.
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
    return NextResponse.json({ ok: true, ...result });
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
