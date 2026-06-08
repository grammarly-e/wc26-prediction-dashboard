import MatchCard from "@/components/MatchCard";
import { getMatches, getTeamNameMap } from "@/lib/data";
import type { Match, MatchRound } from "@/lib/types";

export const revalidate = 0;

const ROUND_ORDER: MatchRound[] = [
  "Group Stage",
  "Round of 32",
  "Round of 16",
  "Quarter-final",
  "Semi-final",
  "Match for third place",
  "Final",
];

function groupByRound(matches: Match[]): Map<MatchRound, Match[]> {
  const grouped = new Map<MatchRound, Match[]>();
  for (const round of ROUND_ORDER) grouped.set(round, []);
  for (const m of matches) {
    const list = grouped.get(m.round) ?? [];
    list.push(m);
    grouped.set(m.round, list);
  }
  return grouped;
}

export default async function MatchesPage() {
  const [matches, teamNames] = await Promise.all([getMatches(), getTeamNameMap()]);
  const grouped = groupByRound(matches);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Full Schedule</h1>
        <p className="mt-1 text-sm text-neutral-500">
          All {matches.length} matches, grouped by round, in kickoff order. Scores and status update live.
        </p>
      </div>

      {ROUND_ORDER.map((round) => {
        const roundMatches = grouped.get(round) ?? [];
        if (roundMatches.length === 0) return null;
        return (
          <section key={round}>
            <h2 className="mb-3 text-lg font-bold">
              {round} <span className="font-normal text-neutral-400">({roundMatches.length})</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {roundMatches.map((m) => (
                <MatchCard key={m.id} match={m} teamNames={teamNames} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
