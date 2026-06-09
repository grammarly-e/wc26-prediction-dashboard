import Link from "next/link";

import FilterBar from "@/components/FilterBar";
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

function teamsConfirmed(match: Match): boolean {
  return Boolean(match.team1_id && match.team2_id);
}

function LockedPredictionCard({ match }: { match: Match }) {
  return (
    <div className="card flex flex-col gap-2 border border-dashed border-neutral-200 p-4 text-sm opacity-60">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>#{match.match_number} · {match.round}</span>
        <span className="badge bg-neutral-100 text-neutral-500">Locked</span>
      </div>
      <div className="flex items-center justify-center gap-3 py-1 font-medium text-neutral-400 italic">
        <span>{match.team1_code || "TBD"}</span>
        <span className="text-xs not-italic">vs</span>
        <span>{match.team2_code || "TBD"}</span>
      </div>
      <p className="text-center text-xs text-neutral-400">
        Unlocks once knockout teams are decided
      </p>
    </div>
  );
}

function filterMatches(
  matches: Match[],
  group: string | null,
  search: string,
  teamNames: Map<string, string>
): Match[] {
  return matches.filter((m) => {
    if (group) {
      if (group === "knockout") {
        if (m.round === "Group Stage") return false;
      } else {
        if (m.group_letter !== group.toUpperCase()) return false;
      }
    }
    if (search) {
      const q = search.toLowerCase();
      const t1 = (m.team1_id ? teamNames.get(m.team1_id) ?? m.team1_code : m.team1_code).toLowerCase();
      const t2 = (m.team2_id ? teamNames.get(m.team2_id) ?? m.team2_code : m.team2_code).toLowerCase();
      if (!t1.includes(q) && !t2.includes(q)) return false;
    }
    return true;
  });
}

export default async function PredictionsPage({
  searchParams,
}: {
  searchParams: { group?: string; q?: string };
}) {
  const participant = await getCurrentParticipant();

  if (!participant) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">Make Your Predictions</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Predict the score of every match, then pick your favourite teams. Picks lock the moment a
            match kicks off, so everyone&rsquo;s guessing blind. Most accurate predictor wins bragging rights
            on the leaderboard.
          </p>
        </div>
        <JoinForm />
      </div>
    );
  }

  const filterGroup = searchParams.group ?? null;
  const filterSearch = (searchParams.q ?? "").trim();

  const [matches, teamNames, myPredictions] = await Promise.all([
    getMatches(),
    getTeamNameMap(),
    getMyMatchPredictions(participant.id),
  ]);

  const filteredMatches = filterMatches(matches, filterGroup, filterSearch, teamNames);
  const grouped = groupByRound(filteredMatches);
  const submittedCount = myPredictions.size;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Make Your Predictions</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Signed in as <span className="font-semibold text-neutral-700">{participant.display_name}</span>{" "}
            &middot; {submittedCount} of {matches.length} match picks submitted. Each one locks automatically at kickoff.
          </p>
        </div>
        <Link
          href="/predictions/categories"
          className="badge shrink-0 bg-pitch text-gold hover:opacity-90"
        >
          Favourite teams + awards &rarr;
        </Link>
      </div>

      {/* Scoring explainer */}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="mb-3 text-sm font-semibold">How scoring works</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
            <span className="text-neutral-700">Correct result + goal difference</span>
            <span className="ml-2 font-bold text-pitch">3 pts</span>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <span className="text-neutral-700">Correct result only (W/D/L)</span>
            <span className="ml-2 font-bold text-emerald-700">1 pt</span>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm sm:col-span-2">
            <span className="text-neutral-500">Wrong result</span>
            <span className="ml-2 font-bold text-neutral-400">0 pts</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Tiers don&rsquo;t stack &mdash; you score the single highest tier you qualify for.
        </p>
      </div>

      <FilterBar activeGroup={filterGroup} activeSearch={filterSearch} />

      {ROUND_ORDER.map((round) => {
        const roundMatches = grouped.get(round) ?? [];
        if (roundMatches.length === 0) return null;
        return (
          <section key={round}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
              {round}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {roundMatches.map((match) =>
                round !== "Group Stage" && !teamsConfirmed(match) ? (
                  <LockedPredictionCard key={match.id} match={match} />
                ) : (
                  <MatchPredictionCard
                    key={match.id}
                    match={match}
                    teamNames={teamNames}
                    participantId={participant.id}
                    existing={myPredictions.get(match.id) ?? null}
                  />
                )
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
