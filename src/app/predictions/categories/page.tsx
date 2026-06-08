import Link from "next/link";

import CategoryPredictionCard from "@/components/CategoryPredictionCard";
import JoinForm from "@/components/JoinForm";
import { getTeamNameMap, getTeams } from "@/lib/data";
import { getCurrentParticipant, getMyTournamentPredictions, getPredictionCategories } from "@/lib/predictions";
import type { PredictionCategory } from "@/lib/types";

export const revalidate = 0;

// Buckets purely for display grouping — every key here must exist in
// supabase/seed/prediction_categories.sql, and any new category not matched
// below falls into "Other categories" so nothing silently disappears.
function groupCategories(categories: PredictionCategory[]) {
  const groups = {
    "Tournament Awards": [] as PredictionCategory[],
    "Group Winners": [] as PredictionCategory[],
    "Knockout Bracket": [] as PredictionCategory[],
    "Other categories": [] as PredictionCategory[],
  };
  for (const c of categories) {
    if (c.group_letter) groups["Group Winners"].push(c);
    else if (c.key.startsWith("quarterfinalist") || c.key.startsWith("semifinalist")) groups["Knockout Bracket"].push(c);
    else if (["champion", "runner_up", "third_place", "golden_boot", "golden_ball", "best_young_player"].includes(c.key))
      groups["Tournament Awards"].push(c);
    else groups["Other categories"].push(c);
  }
  return groups;
}

export default async function CategoryPredictionsPage() {
  const participant = await getCurrentParticipant();

  if (!participant) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">Tournament Award Picks</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Call the Champion, the Golden Boot winner, group winners, and more — each one worth bonus points on
            top of your match predictions.
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
  const submittedCount = myPicks.size;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tournament Award Picks</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Signed in as <span className="font-semibold text-neutral-700">{participant.display_name}</span> ·{" "}
            {submittedCount} of {categories.length} picks submitted. Each category locks at the time shown — no
            changes after that.
          </p>
        </div>
        <Link href="/predictions" className="badge shrink-0 bg-pitch text-gold hover:opacity-90">
          ← Match-by-match picks
        </Link>
      </div>

      {Object.entries(grouped).map(([groupName, groupCategories]) => {
        if (groupCategories.length === 0) return null;
        return (
          <section key={groupName}>
            <h2 className="mb-3 text-lg font-bold">
              {groupName} <span className="font-normal text-neutral-400">({groupCategories.length})</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {groupCategories.map((c) => (
                <CategoryPredictionCard
                  key={c.key}
                  category={c}
                  teams={teams}
                  teamNames={teamNames}
                  participantId={participant.id}
                  existing={myPicks.get(c.key) ?? null}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
