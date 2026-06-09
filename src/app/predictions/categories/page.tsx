import Link from "next/link";

import CategoryPredictionCard from "@/components/CategoryPredictionCard";
import JoinForm from "@/components/JoinForm";
import { getTeamNameMap, getTeams } from "@/lib/data";
import { getCurrentParticipant, getMyTournamentPredictions, getPredictionCategories } from "@/lib/predictions";
import type { PredictionCategory } from "@/lib/types";

export const revalidate = 0;

// ----------------------------------------------------------------------------
// Favourite Teams + Tournament Awards
//
// Group winner and bracket qualifier predictions have been removed — those
// outcomes are already determined by match results. This page now shows only:
//
//   "My 3 Favourite Teams" — champion/runner_up/third_place keys, reframed
//   as casual "who are you rooting for" rather than scored predictions.
//
//   "Tournament Awards" — Golden Boot, Golden Ball, Best Young Player.
//
// Neither section affects the leaderboard ranking (points_value = 0 for all
// categories). They are purely fun picks.
// ----------------------------------------------------------------------------

const FAVOURITE_KEYS = new Set(["champion", "runner_up", "third_place"]);
const FAVOURITE_LABELS: Record<string, string> = {
  champion: "Favourite Team #1",
  runner_up: "Favourite Team #2",
  third_place: "Favourite Team #3",
};

const AWARD_KEYS = new Set(["golden_boot", "golden_ball", "best_young_player"]);

function groupCategories(categories: PredictionCategory[]) {
  const groups: Record<string, PredictionCategory[]> = {
    "My 3 Favourite Teams": [],
    "Tournament Awards": [],
  };
  for (const c of categories) {
    if (FAVOURITE_KEYS.has(c.key)) {
      groups["My 3 Favourite Teams"].push({ ...c, label: FAVOURITE_LABELS[c.key] ?? c.label });
    } else if (AWARD_KEYS.has(c.key)) {
      groups["Tournament Awards"].push(c);
    }
    // Group Winners and Knockout Bracket categories are intentionally excluded.
  }
  return groups;
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  "My 3 Favourite Teams":
    "Pick the 3 teams you're rooting for — just for fun, no points on the line.",
  "Tournament Awards":
    "Call the Golden Boot, Golden Ball, and Best Young Player. Just for bragging rights.",
};

export default async function CategoryPredictionsPage() {
  const participant = await getCurrentParticipant();

  if (!participant) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">Favourites + Awards</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Pick your 3 favourite teams and call the Golden Boot winner. Join to lock in your picks.
          </p>
        </div>
        <JoinForm />
      </div>
    );
  }

  const [categories, teams, teamNames, myPicks] = await Promise.all([
    getPredictionCategories(),
    getTeams(),
    getTeamNameMap(),
    getMyTournamentPredictions(participant.id),
  ]);
  const grouped = groupCategories(categories);
  const displayGroups = (Object.entries(grouped) as [string, PredictionCategory[]][]).filter(
    ([, cats]) => cats.length > 0
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Favourites + Awards</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            These picks are just for fun — they don't affect your leaderboard score. The ranking is
            based entirely on match predictions.
          </p>
        </div>
        <Link
          href="/predictions"
          className="shrink-0 rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-gold hover:opacity-90"
        >
          Match picks →
        </Link>
      </div>

      {displayGroups.map(([groupName, cats]) => (
        <section key={groupName}>
          <h2 className="mb-1 font-semibold text-neutral-700">{groupName}</h2>
          {GROUP_DESCRIPTIONS[groupName] && (
            <p className="mb-4 text-sm text-neutral-500">{GROUP_DESCRIPTIONS[groupName]}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cats.map((category) => (
              <CategoryPredictionCard
                key={category.key}
                category={category}
                teams={teams}
                teamNames={teamNames}
                existing={myPicks.get(category.key) ?? null}
                participantId={participant.id}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
