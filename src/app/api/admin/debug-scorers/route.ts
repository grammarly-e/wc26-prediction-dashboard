import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminTokenHash } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

function isAuthenticated(): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  return cookies().get("admin_token")?.value === adminTokenHash();
}

export async function GET() {
  if (!isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const results: Record<string, unknown> = {};

  // 1. Count all match_events
  const { count: totalEvents, error: e1 } = await supabase
    .from("match_events")
    .select("*", { count: "exact", head: true });
  results.match_events_total = e1 ? `ERROR: ${e1.message}` : totalEvents;

  // 2. Count goal events with non-null player_name
  const { data: goalEvents, error: e2 } = await supabase
    .from("match_events")
    .select("player_name, team_id, event_type, minute")
    .in("event_type", ["goal", "penalty_goal"])
    .not("player_name", "is", null);
  results.goal_events_error = e2?.message ?? null;
  results.goal_events_count = e2 ? 0 : (goalEvents?.length ?? 0);
  results.goal_events_sample = e2 ? [] : (goalEvents ?? []).slice(0, 10);

  // 3. Count top_scorers rows
  const { data: scorerRows, error: e3 } = await supabase
    .from("top_scorers")
    .select("player_name, goals, rank, team_id");
  results.top_scorers_error = e3?.message ?? null;
  results.top_scorers_count = e3 ? 0 : (scorerRows?.length ?? 0);
  results.top_scorers_rows = e3 ? [] : scorerRows;

  // 4. Try a test insert + delete to confirm write access
  const testName = `__debug_test_${Date.now()}`;
  const { error: insErr } = await supabase.from("top_scorers").insert({
    player_name: testName,
    player_id: null,
    team_id: null,
    goals: 0,
    assists: 0,
    rank: 999,
  });
  results.test_insert_error = insErr?.message ?? null;
  results.test_insert_ok = !insErr;

  if (!insErr) {
    const { error: delErr } = await supabase
      .from("top_scorers")
      .delete()
      .eq("player_name", testName);
    results.test_delete_error = delErr?.message ?? null;
    results.test_delete_ok = !delErr;
  }

  return NextResponse.json(results, { status: 200 });
}
