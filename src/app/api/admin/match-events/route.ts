import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { rebuildTopScorersFromEvents } from "@/lib/sync";

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

/** GET /api/admin/match-events?matchId=xxx */
export async function GET(request: Request) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("matchId");
  if (!matchId) {
    return NextResponse.json({ error: "matchId required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("match_events")
    .select("id, team_id, player_name, minute, event_type, detail")
    .eq("match_id", matchId)
    .order("minute", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}

/** POST /api/admin/match-events — add one event */
export async function POST(request: Request) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    matchId: string;
    teamId: string | null;
    playerName: string;
    minute: number;
    eventType: "goal" | "own_goal" | "penalty_goal";
    detail: string | null;
  };

  if (!body.matchId || !body.playerName || body.minute == null || !body.eventType) {
    return NextResponse.json({ error: "matchId, playerName, minute, eventType required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("match_events").insert({
    match_id: body.matchId,
    team_id: body.teamId ?? null,
    player_id: null,
    player_name: body.playerName.trim(),
    minute: body.minute,
    event_type: body.eventType,
    detail: body.detail ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Rebuild top_scorers to reflect the new event.
  try {
    await rebuildTopScorersFromEvents();
  } catch (err) {
    console.error("[match-events POST] rebuildTopScorers failed:", err);
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/match-events — remove one event by ID */
export async function DELETE(request: Request) {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { eventId: string };
  if (!body.eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("match_events")
    .delete()
    .eq("id", body.eventId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Rebuild top_scorers after deletion.
  try {
    await rebuildTopScorersFromEvents();
  } catch (err) {
    console.error("[match-events DELETE] rebuildTopScorers failed:", err);
  }

  return NextResponse.json({ ok: true });
}
