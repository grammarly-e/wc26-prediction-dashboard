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
 * Returns null on success, or an error message string on failure.
 */
async function rebuildTopScorers(): Promise<string | null> {
  const supabase = createServiceRoleClient();

  const { data: events, error: evErr } = await supabase
    .from("match_events")
    .select("player_name, team_id, event_type")
    .in("event_type", ["goal", "penalty_goal"])
    .not("player_name", "is", null);

  if (evErr) {
    const msg = `[rebuildTopScorers] query failed: ${evErr.message}`;
    console.error(msg);
    return msg;
  }

  if (!events?.length) {
    const { error: clrErr } = await supabase
      .from("top_scorers")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (clrErr) {
      const msg = `[rebuildTopScorers] clear failed: ${clrErr.message}`;
      console.error(msg);
      return msg;
    }
    return null;
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
    // Goals first, then name — keeps players tied on goals in a stable,
    // alphabetical order instead of Map insertion order.
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));

  const { error: delErr } = await supabase
    .from("top_scorers")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) {
    const msg = `[rebuildTopScorers] delete failed: ${delErr.message}`;
    console.error(msg);
    return msg;
  }

  const insertErrors: string[] = [];
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
    if (insErr) {
      const msg = `${s.name}: ${insErr.message}`;
      console.error(`[rebuildTopScorers] insert failed — ${msg}`);
      insertErrors.push(msg);
    }
  }

  if (insertErrors.length) {
    return `top_scorers insert failed for ${insertErrors.length} row(s): ${insertErrors.join("; ")}`;
  }

  console.log(`[rebuildTopScorers] wrote ${scorers.length} scorer(s) from match_events`);
  return null;
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

  const rebuildError = await rebuildTopScorers();
  if (rebuildError) {
    return NextResponse.json({ ok: true, rebuildWarning: rebuildError });
  }

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

  const rebuildError = await rebuildTopScorers();
  if (rebuildError) {
    return NextResponse.json({ ok: true, rebuildWarning: rebuildError });
  }

  return NextResponse.json({ ok: true });
}
