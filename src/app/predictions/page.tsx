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

// forceTeamsTBD: hide placeholder codes (e.g. "W-A1") during the group stage
function LockedPredictionCard({ match, forceTeamsTBD }: { match: Match; forceTeamsTBD?: boolean }) {
  const t1 = forceTeamsTBD ? "TBD" : (match.team1_code || "TBD");
  const t2 = forceTeamsTBD ? "TBD" : (match.team2_code || "TBD");
  return (
    <div className="card flex flex-col gap-2 border border-dashed border-neutral-200 p-4 text-sm opacity-60">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>#{match.match_number} · {match.round}</span>
        <span className="badge bg-neutral-100 text-neutral-500">
          {forceTeamsTBD ? "Group stage pending" : "Locked"}
        </span>
      </div>
      <div className="flex items-center justify-center gap-3 py-1 font-medium text-neutral-400 italic">
        <span>{t1}</span>
        <span className="text-xs not-italic">vs</span>
        <span>{t2}</span>
      </div>
      <p className="text-center text-xs text-neutral-400">
        {forceTeamsTBD
          ? "Opens once all group stage matches are finished"
          : "Unlocks once knockout teams are decided"}
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

  // Block ALL Round of 32 matches until every group-stage match is finished.
  const allGroupStageFinished = matches.every(
    (m) => m.round !== "Group Stage" || m.status === "finished"
  );

  // Progress bar denominator: only count matches the user can actually pick.
  // During the group stage that is the 72 group matches; once group stage
  // finishes it expands to all matches with confirmed teams.
  const availableCount = allGroupStageFinished
    ? matches.filter((m) => m.round === "Group Stage" || teamsConfirmed(m)).length
    : matches.filter((m) => m.round === "Group Stage").length;

  const filteredMatches = filterMatches(matches, filterGroup, filterSearch, teamNames);
  const grouped = groupByRound(filteredMatches);
  const submittedCount = myPredictions.size;
  const pct = availableCount > 0 ? Math.round((submittedCount / availableCount) * 100) : 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">Make Your Predictions</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Signed in as{" "}
            <span className="font-semibold text-neutral-700">{participant.display_name}</span>
            {" "}&middot; picks lock automatically at kickoff.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200">
              <div className="h-full rounded-full bg-pitch transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-600">
              {submittedCount}/{availableCount} picks
            </span>
            {submittedCount === availableCount && availableCount > 0 && (
              <span className="shrink-0 text-xs font-semibold text-emerald-600">All done ✓</span>
            )}
          </div>
        </div>
        <Link
          href="/predictions/categories"
          className="shrink-0 rounded-xl bg-pitch px-5 py-3 text-sm font-bold text-gold shadow-md transition-opacity hover:opacity-90"
        >
          ⭐ Favourite Teams &amp; Awards
        </Link>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="mb-3 text-sm font-semibold">How scoring works</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm">
            <div className="font-semibold text-emerald-700">🎯 Perfect call</div>
            <div className="text-neutral-600">You named the exact final scoreline.</div>
            <div className="mt-0.5 font-bold text-emerald-700">5 pts</div>
          </div>
          <div className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm">
            <div className="font-semibold text-blue-700">Sharp eye</div>
            <div className="text-neutral-600">Right result and correct goal margin.</div>
            <div className="mt-0.5 font-bold text-blue-700">3 pts</div>
          </div>
          <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm">
            <div className="font-semibold text-yellow-700">Called it</div>
            <div className="text-neutral-600">Right W/D/L outcome, wrong margin.</div>
            <div className="mt-0.5 font-bold text-yellow-700">2 pts</div>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
            <div className="font-semibold text-red-500">Missed</div>
            <div className="text-neutral-500">Wrong result entirely.</div>
            <div className="mt-0.5 font-bold text-red-400">0 pts</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-neutral-400">Tiers don&rsquo;t stack &mdash; you score the single highest tier you qualify for.</p>
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
              {roundMatches.map((match) => {
                const groupStagePending = round === "Round of 32" && !allGroupStageFinished;
                const teamsUnknown = round !== "Group Stage" && !teamsConfirmed(match);
                if (groupStagePending || teamsUnknown) {
                  return (
                    <LockedPredictionCard
                      key={match.id}
                      match={match}
                      forceTeamsTBD={groupStagePending}
                    />
                  );
                }
                return (
                  <MatchPredictionCard
                    key={match.id}
                    match={match}
                    teamNames={teamNames}
                    participantId={participant.id}
                    existing={myPredictions.get(match.id) ?? null}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
