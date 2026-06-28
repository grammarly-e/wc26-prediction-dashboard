import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getMatches, getTeams } from "@/lib/data";
import { fetchAllRows } from "@/lib/predictions";
import AdminLoginForm from "./AdminLoginForm";
import AdminDashboard, { type ParticipantRow } from "./AdminDashboard";

export const revalidate = 0;

async function getParticipantsWithCounts(): Promise<ParticipantRow[]> {
  const supabase = createServiceRoleClient();

  // match_predictions read is paginated (see fetchAllRows in predictions.ts):
  // this scans every participant's rows with no per-participant filter, the
  // same unbounded-read shape that silently truncates at Supabase's 1000-row
  // default cap once the table grows past it.
  const [{ data: participants, error: pErr }, preds] = await Promise.all([
    supabase
      .from("participants")
      .select("id, display_name, created_at")
      .order("created_at", { ascending: true }),
    fetchAllRows<{ participant_id: string }>((from, to) =>
      supabase.from("match_predictions").select("participant_id").range(from, to)
    ),
  ]);

  if (pErr) throw pErr;

  const countMap = new Map<string, number>();
  for (const row of preds) {
    countMap.set(row.participant_id, (countMap.get(row.participant_id) ?? 0) + 1);
  }

  return ((participants ?? []) as { id: string; display_name: string; created_at: string }[]).map(
    (p) => ({
      ...p,
      match_prediction_count: countMap.get(p.id) ?? 0,
    })
  );
}

export default async function AdminPage() {
  if (!isAdminAuthenticated()) {
    return <AdminLoginForm />;
  }

  const [matches, participants, teams] = await Promise.all([
    getMatches(),
    getParticipantsWithCounts(),
    getTeams(),
  ]);

  return <AdminDashboard matches={matches} participants={participants} teams={teams} />;
}
