// Admin-triggered sync — calls runSync() directly, protected by admin_token cookie.
// This is separate from /api/sync (which uses SYNC_SECRET for the Vercel cron).
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { runSync } from "@/lib/sync";

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

export async function POST() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSync();
    return NextResponse.json({ ok: true, finishedScored: result.finishedScored });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
