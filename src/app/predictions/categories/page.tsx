import Link from "next/link";

import CategoryPredictionCard from "@/components/CategoryPredictionCard";
import FavouritesPickSection from "@/components/FavouritesPickSection";
import JoinForm from "@/components/JoinForm";
import { getTeamNameMap, getTeams } from "@/lib/data";
import { TEAM_ODDS } from "@/lib/odds";
import { getCurrentParticipant, getMyTournamentPredictions, getPredictionCategories } from "@/lib/predictions";
import type { PredictionCategory } from "@/lib/types";

export const revalidate = 0;

const FAVOURITE_KEYS = new Set(["champion", "runner_up", "third_place"]);
const AWARD_KEYS = new Set(["golden_boot", "golden_ball", "best_young_player"]);

function groupCategories(categories: PredictionCategory[]) {
  const groups: Record<string, PredictionCategory[]> = {
    "My 3 Favourite Teams": [],
    "Tournament Awards": [],
  };
  for (const c of categories) {
    if (FAVOURITE_KEYS.has(c.key)) {
      groups["My 3 Favourite Teams"].push(c);
    } else if (AWARD_KEYS.has(c.key)) {
      groups["Tournament Awards"].push(c);
    }
  }
  return groups;
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  "My 3 Favourite Teams":
    "Pick 3 teams you're rooting for. Your combined odds must total 25% or under -- no stacking all the favourites in one entry.",
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

  const playingTeams = teams.filter((t) => !t.is_placeholder);

  const teamNamesRecord: Record<string, string> = {};
  for (const [id, name] of teamNames) {
    teamNamesRecord[id] = name;
  }

  const existingFavouriteIds: Record<string, string> = {};
  for (const key of ["champion", "runner_up", "third_place"]) {
    const pick = myPicks.get(key);
    if (pick?.predicted_team_id) existingFavouriteIds[key] = pick.predicted_team_id;
  }

  const teamIdOdds: Record<string, number> = {};
  for (const team of playingTeams) {
    const odds = TEAM_ODDS[team.name];
    if (odds !== undefined) teamIdOdds[team.id] = odds;
  }

  const RELEVANT_KEYS = new Set(["champion", "runner_up", "third_place", "golden_boot", "golden_ball", "best_young_player"]);
  const relevantCats = categories.filter((c) => RELEVANT_KEYS.has(c.key));
  const totalCats = relevantCats.length;
  const filledCats = relevantCats.filter((c) => myPicks.has(c.key)).length;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">Favourites + Awards</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Your favourite teams earn points on the Favourites Leaderboard as they progress. Award picks (Golden Boot, Golden Ball, Best Young Player) score bonus points if you call them right.
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
            {relevantCats.map((c) => {
              const filled = myPicks.has(c.key);
              return (
                <span
                  key={c.key}
                  title={`${c.label}: ${filled ? "picked" : "not picked"}`}
                  className={`h-2 w-2 rounded-full ${filled ? "bg-emerald-500" : "bg-neutral-200"}`}
                />
              );
            })}
            <span className="ml-1">{filledCats}/{totalCats} picks</span>
          </div>
        </div>
        <Link
          href="/predictions"
          className="shrink-0 rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-gold hover:opacity-90"
        >
          Match picks &rarr;
        </Link>
      </div>

      {displayGroups.map(([groupName, cats]) => (
        <section key={groupName}>
          <h2 className="mb-1 font-semibold text-neutral-700">{groupName}</h2>
          {GROUP_DESCRIPTIONS[groupName] && (
            <p className="mb-4 text-sm text-neutral-500">{GROUP_DESCRIPTIONS[groupName]}</p>
          )}

          {groupName === "My 3 Favourite Teams" ? (
            <FavouritesPickSection
              categories={cats}
              teams={playingTeams}
              teamNames={teamNamesRecord}
              existingTeamIds={existingFavouriteIds}
              participantId={participant.id}
              teamIdOdds={teamIdOdds}
            />
          ) : (
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
          )}
        </section>
      ))}
    </div>
  );
}
