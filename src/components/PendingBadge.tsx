// Server component — counts upcoming matches the participant can actually
// predict right now but hasn't yet. Mirrors the availability logic in
// src/app/predictions/page.tsx so the badge stays in sync with the UI.
import { getMatches } from "@/lib/data";
import { getCurrentParticipant, getMyMatchPredictions } from "@/lib/predictions";

export default async function PendingBadge() {
  const participant = await getCurrentParticipant();
  if (!participant) return null;

  const [matches, myPredictions] = await Promise.all([
    getMatches(),
    getMyMatchPredictions(participant.id),
  ]);

  // Mirror the predictions page: Round of 32+ are locked until every
  // group stage match is finished, even if their team IDs are already set.
  const allGroupStageFinished = matches.every(
    (m) => m.round !== "Group Stage" || m.status === "finished"
  );

  const count = matches.filter((m) => {
    if (m.status !== "scheduled") return false;
    if (!m.team1_id || !m.team2_id) return false;
    // Only count knockout matches once the group stage is complete.
    if (m.round !== "Group Stage" && !allGroupStageFinished) return false;
    return !myPredictions.has(m.id);
  }).length;

  if (count === 0) return null;

  return (
    <span className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
