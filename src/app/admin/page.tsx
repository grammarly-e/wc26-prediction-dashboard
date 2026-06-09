import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getMatches } from "@/lib/data";
import AdminLoginForm from "./AdminLoginForm";
import AdminDashboard, { type ParticipantRow } from "./AdminDashboard";

export const revalidate = 0;

async function getParticipantsWithCounts(): Promise<ParticipantRow[]> {
  const supabase = createServiceRoleClient();

  const [{ data: participants, error: pErr }, { data: preds, error: cErr }] =
    await Promise.all([
      supabase
        .from("participants")
        .select("id, display_name, created_at")
        .order("created_at", { ascending: true }),
      supabase.from("match_predictions").select("participant_id"),
    ]);

  if (pErr) throw pErr;
  if (cErr) throw cErr;

  const countMap = new Map<string, number>();
  for (const row of (preds ?? []) as { participant_id: string }[]) {
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

  const [matches, participants] = await Promise.all([
    getMatches(),
    getParticipantsWithCounts(),
  ]);

  return <AdminDashboard matches={matches} participants={participants} />;
}
