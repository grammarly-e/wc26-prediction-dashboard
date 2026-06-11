// Server component — fetches the current participant's prediction coverage and
// returns a badge showing how many upcoming matches are still unpredicted.
// Rendered via Suspense in layout.tsx so it never blocks navigation.
import { getMatches } from "@/lib/data";
import { getCurrentParticipant, getMyMatchPredictions } from "@/lib/predictions";

export default async function PendingBadge() {
  const participant = await getCurrentParticipant();
  if (!participant) return null;

  const [matches, myPredictions] = await Promise.all([
    getMatches(),
    getMyMatchPredictions(participant.id),
  ]);

  // Count scheduled matches with confirmed teams (i.e. ones the user CAN predict)
  // that don't yet have a prediction.
  const count = matches.filter(
    (m) =>
      m.status === "scheduled" &&
      m.team1_id &&
      m.team2_id &&
      !myPredictions.has(m.id)
  ).length;

  if (count === 0) return null;

  return (
    <span className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
