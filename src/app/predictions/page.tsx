import Link from "next/link";

import JoinForm from "@/components/JoinForm";
import MatchPredictionCard from "@/components/MatchPredictionCard";
import { getMatches, getTeamNameMap } from "@/lib/data";
import { getCurrentParticipant, getMyMatchPredictions } from "@/lib/predictions";
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

export default async function PredictionsPage() {
  const participant = await getCurrentParticipant();

  if (!participant) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">Make Your Predictions</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Predict the score of every match, then call the tournament&rsquo;s biggest awards — Champion, Golden
            Boot, and more. Picks lock the moment a match kicks off or a category&rsquo;s deadline passes, so
            everyone&rsquo;s guessing blind. Most accurate predictor wins bragging rights on the leaderboard.
          </p>
        </div>
        <JoinForm />
      </div>
    );
  }

  const [matches, teamNames, myPredictions] = await Promise.all([
    getMatches(),
    getTeamNameMap(),
    getMyMatchPredictions(participant.id),
  ]);
  const grouped = groupByRound(matches);
  const submittedCount = myPredictions.size;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Make Your Predictions</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Signed in as <span className="font-semibold text-neutral-700">{participant.display_name}</span> ·{" "}
            {submittedCount} of {matches.length} match picks submitted. Each one locks automatically at kickoff.
          </p>
        </div>
        <Link
          href="/predictions/categories"
          className="badge shrink-0 bg-pitch text-gold hover:opacity-90"
        >
          Tournament award picks →
        </Link>
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
                <MatchPredictionCard
                  key={m.id}
                  match={m}
                  teamNames={teamNames}
                  participantId={participant.id}
                  existing={myPredictions.get(m.id) ?? null}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
