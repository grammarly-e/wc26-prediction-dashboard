import Link from "next/link";

import CategoryPredictionCard from "@/components/CategoryPredictionCard";
import JoinForm from "@/components/JoinForm";
import { getTeamNameMap, getTeams } from "@/lib/data";
import { getCurrentParticipant, getMyTournamentPredictions, getPredictionCategories } from "@/lib/predictions";
import type { PredictionCategory } from "@/lib/types";

export const revalidate = 0;

// ----------------------------------------------------------------------------
// "My 3 Favourite Teams" framing.
//
// The underlying DB categories (champion / runner_up / third_place) and their
// scoring rules are unchanged — they still award points if a team wins / comes
// second / comes third. The framing change is purely presentational: instead
// of asking "who will WIN the tournament?" we ask "which 3 teams are you
// rooting for?" This is friendlier for casual participants and still rewards
// correct calls.
//
// The key→label override happens here (server-side) before the cards render,
// so CategoryPredictionCard stays unmodified and the DB schema is untouched.
// ----------------------------------------------------------------------------

const FAVOURITE_KEYS = new Set(["champion", "runner_up", "third_place"]);
const FAVOURITE_LABELS: Record<string, string> = {
  champion: "Favourite Team #1",
  runner_up: "Favourite Team #2",
  third_place: "Favourite Team #3",
};

function groupCategories(categories: PredictionCategory[]) {
  const groups: Record<string, PredictionCategory[]> = {
    "My 3 Favourite Teams": [],
    "Tournament Awards": [],
    "Group Winners": [],
    "Knockout Bracket": [],
    "Other categories": [],
  };
  for (const c of categories) {
    if (FAVOURITE_KEYS.has(c.key)) {
      // Override the label to the casual "Favourite Team" framing before passing to the card.
      groups["My 3 Favourite Teams"].push({ ...c, label: FAVOURITE_LABELS[c.key] ?? c.label });
    } else if (c.group_letter) {
      groups["Group Winners"].push(c);
    } else if (c.key.startsWith("quarterfinalist") || c.key.startsWith("semifinalist")) {
      groups["Knockout Bracket"].push(c);
    } else if (["golden_boot", "golden_ball", "best_young_player"].includes(c.key)) {
      groups["Tournament Awards"].push(c);
    } else {
      groups["Other categories"].push(c);
    }
  }
  return groups;
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  "My 3 Favourite Teams":
    "Pick the 3 teams you're rooting for. Points if they go all the way — higher picks earn more.",
  "Tournament Awards":
    "Call the Golden Boot, Golden Ball, and Best Young Player. Each locks at tournament kickoff.",
  "Group Winners":
    "Which team tops each group? Locks at tournament kickoff so you're guessing blind.",
  "Knockout Bracket":
    "Who reaches the quarters and semis? Locks once the Round of 32 draw is confirmed.",
};

export default async function CategoryPredictionsPage() {
  const participant = await getCurrentParticipant();

  if (!participant) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">Favourites + Awards</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Pick your 3 favourite teams, call the Golden Boot winner, predict group winners, and more.
            Join to lock in your picks before the tournament kicks off.
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
          <h1 className="text-2xl font-bold">Favourites + Awards</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Signed in as <span className="font-semibold text-neutral-700">{participant.display_name}</span> ·{" "}
            {submittedCount} of {categories.length} picks submitted. Each category locks at the time shown.
          </p>
        </div>
        <Link href="/predictions" className="badge shrink-0 bg-pitch text-gold hover:opacity-90">
          ← Match-by-match picks
        </Link>
      </div>

      {Object.entries(grouped).map(([groupName, groupCategories]) => {
        if (groupCategories.length === 0) return null;
        const description = GROUP_DESCRIPTIONS[groupName];
        return (
          <section key={groupName}>
            <div className="mb-3">
              <h2 className="text-lg font-bold">
                {groupName} <span className="font-normal text-neutral-400">({groupCategories.length})</span>
              </h2>
              {description && (
                <p className="mt-0.5 text-sm text-neutral-500">{description}</p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
