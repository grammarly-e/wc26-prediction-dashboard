// ============================================================================
// Shared goal-aggregation helper, built directly from match_events.
//
// Two call sites independently re-derived this same aggregation before it was
// extracted here:
//   - sync.ts's buildScorersFromEvents() — last-resort source when both
//     external scorer APIs return nothing, used to populate top_scorers.
//   - data.ts's getTopScorers() fallback — read-time safety net so
//     admin-entered match events are never silently lost if a top_scorers
//     write failed.
//
// Both now call aggregateGoalsFromMatchEvents() and map the result into
// whatever shape they need. Assists aren't tracked in match_events, so this
// only returns goals; callers default assists to 0.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export interface AggregatedScorer {
  name: string;
  teamId: string | null;
  teamName: string | null;
  goals: number;
}

export async function aggregateGoalsFromMatchEvents(
  supabase: SupabaseClient<Database>
): Promise<AggregatedScorer[]> {
  const { data: events, error } = await supabase
    .from("match_events")
    .select("player_name, team_id, event_type")
    .in("event_type", ["goal", "penalty_goal"])
    .not("player_name", "is", null);
  if (error || !events?.length) return [];

  const { data: teams } = await supabase.from("teams").select("id, name");
  const teamNameById = new Map<string, string>(
    ((teams ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name])
  );

  const counts = new Map<string, { goals: number; teamId: string | null }>();
  for (const row of events as { player_name: string | null; team_id: string | null; event_type: string }[]) {
    if (!row.player_name) continue;
    const entry = counts.get(row.player_name) ?? { goals: 0, teamId: row.team_id };
    entry.goals += 1;
    counts.set(row.player_name, entry);
  }

  return Array.from(counts.entries())
    .map(([name, { goals, teamId }]) => ({
      name,
      teamId,
      teamName: teamId ? teamNameById.get(teamId) ?? null : null,
      goals,
    }))
    .filter((e) => e.goals > 0)
    .sort((a, b) => b.goals - a.goals);
}
