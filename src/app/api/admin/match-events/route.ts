import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

/**
 * Rebuild top_scorers directly from match_events.
 * Inlined here so it uses the same createServiceRoleClient as the rest of
 * this route — no dependency on sync.ts internals.
 */
async function rebuildTopScorers(): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: events, error: evErr } = await supabase
    .from("match_events")
    .select("player_name, team_id, event_type")
    .in("event_type", ["goal", "penalty_goal"])
    .not("player_name", "is", null);

  if (evErr) {
    console.error("[rebuildTopScorers] query failed:", evErr.message);
    return;
  }

  if (!events?.length) {
    await supabase.from("top_scorers").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    return;
  }

  const counts = new Map<string, { goals: number; teamId: string | null }>();
  for (const ev of events as { player_name: string | null; team_id: string | null; event_type: string }[]) {
    if (!ev.player_name) continue;
    const entry = counts.get(ev.player_name) ?? { goals: 0, teamId: ev.team_id };
    entry.goals += 1;
    counts.set(ev.player_name, entry);
  }

  const scorers = Array.from(counts.entries())
    .map(([name, { goals, teamId }]) => ({ name, goals, teamId }))
    .sort((a, b) => b.goals - a.goals);

  const { error: delErr } = await supabase
    .from("top_scorers")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) {
    console.error("[rebuildTopScorers] delete failed:", delErr.message);
    return;
  }

  for (let i = 0; i < scorers.length; i++) {
    const s = scorers[i];
    const { error: insErr } = await supabase.from("top_scorers").insert({
      player_name: s.name,
      player_id: null,
      team_id: s.teamId ?? null,
      goals: s.goals,
      assists: 0,
      rank: i + 1,
    });
    if (insErr) console.error("[rebuildTopScorers] insert " + s.name + ": " + insErr.message);
  }
  console.log("[rebuildTopScorers] wrote " + scorers.length + " scorer(s) from match_events");
}

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

  await rebuildTopScorers();

  return NextResponse.json({ ok: true });
}

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

  await rebuildTopScorers();

  return NextResponse.json({ ok: true });
}
