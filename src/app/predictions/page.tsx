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

// ----------------------------------------------------------------------------
// Knockout lock — teams are TBD until the group stage is complete.
// The locked card blocks both the form and the score input, so there's no
// way to accidentally submit a pick for a match that hasn't been drawn yet.
// ----------------------------------------------------------------------------

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

// ----------------------------------------------------------------------------
// Server-side filter logic — mirrors the filter on the main matches page.
// ----------------------------------------------------------------------------

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
            Signed in as <span className="font-semibold text-neutral-700">{participant.display_name}</span> ·{" "}
            {submittedCount} of {matches.length} match picks submitted. Each one locks automatically at kickoff.
          </p>
        </div>
        <Link
          href="/predictions/categories"
          className="badge shrink-0 bg-pitch text-gold hover:opacity-90"
        >
          Favourite teams + awards →
        </Link>
      </div>

      <details className="card group p-4 text-sm text-neutral-600 open:pb-4 [&:not([open])]:pb-3">
        <summary className="cursor-pointer list-none font-semibold text-neutral-800 marker:hidden">
          <span className="inline-flex items-center gap-2">
            How scoring works
            <span className="text-xs font-normal text-neutral-400 group-open:hidden">(click to expand)</span>
          </span>
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <p className="flex items-center justify-between rounded-lg bg-gold/10 px-3 py-2">
            <span>Exact scoreline</span>
            <span className="font-mono font-bold text-pitch">25 pts</span>
          </p>
          <p className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2">
            <span>Correct result + goal difference</span>
            <span className="font-mono font-bold text-emerald-700">15 pts</span>
          </p>
          <p className="flex items-center justify-between rounded-lg bg-sky-50 px-3 py-2">
            <span>Correct result only (W/D/L)</span>
            <span className="font-mono font-bold text-sky-700">8 pts</span>
          </p>
          <p className="flex items-center justify-between rounded-lg bg-neutral-100 px-3 py-2">
            <span>Close call (both scores within 1 goal, wrong result)</span>
            <span className="font-mono font-bold text-neutral-600">3 pts</span>
          </p>
        </div>
        <p className="mt-3 text-xs text-neutral-400">
          Tiers don&rsquo;t stack — you get the single highest one you qualify for.
        </p>
      </details>

      <div className="flex flex-col gap-4">
        <FilterBar activeGroup={filterGroup} activeSearch={filterSearch} />

        {filteredMatches.length === 0 && (
          <p className="card p-4 text-sm text-neutral-500">No matches found for this filter.</p>
        )}

        {ROUND_ORDER.map((round) => {
          const roundMatches = grouped.get(round) ?? [];
          if (roundMatches.length === 0) return null;
          return (
            <section key={round}>
              <h2 className="mb-3 text-lg font-bold">
                {round} <span className="font-normal text-neutral-400">({roundMatches.length})</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {roundMatches.map((m) =>
                  round !== "Group Stage" && !teamsConfirmed(m) ? (
                    <LockedPredictionCard key={m.id} match={m} />
                  ) : (
                    <MatchPredictionCard
                      key={m.id}
                      match={m}
                      teamNames={teamNames}
                      participantId={participant.id}
                      existing={myPredictions.get(m.id) ?? null}
                    />
                  )
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
