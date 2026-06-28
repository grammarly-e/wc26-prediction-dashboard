import Link from "next/link";

import FilterBar from "@/components/FilterBar";
import JoinForm from "@/components/JoinForm";
import MatchPredictionCard from "@/components/MatchPredictionCard";
import ScoreBanner from "@/components/ScoreBanner";
import { getMatches, getTeamNameMap } from "@/lib/data";
import { getCurrentParticipant, getMyMatchPredictions } from "@/lib/predictions";
import { DISPLAY_ROUND_ORDER, filterMatches, groupByRound } from "@/lib/match-utils";
import type { Match, MatchPrediction } from "@/lib/types";

export const revalidate = 0;

function teamsConfirmed(match: Match): boolean {
  return Boolean(match.team1_id && match.team2_id);
}

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

// ============================================================================
// Personal stats — computed server-side from myPredictions
// ============================================================================

function PersonalStats({ predictions, totalAvailable }: { predictions: MatchPrediction[]; totalAvailable: number }) {
  const scored = predictions.filter((p) => p.points_awarded !== null);
  if (scored.length === 0) return null;

  const totalPoints = scored.reduce((sum, p) => sum + (p.points_awarded ?? 0), 0);
  const exactHits = scored.filter((p) => p.score_breakdown?.exact_score === true).length;
  const correctOutcomes = scored.filter((p) => p.score_breakdown?.correct_outcome === true).length;
  const accuracyPct = scored.length > 0 ? Math.round((correctOutcomes / scored.length) * 100) : 0;

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <p className="mb-3 text-sm font-semibold text-neutral-700">Your stats so far</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Match points" value={String(totalPoints)} accent="text-pitch" />
        <StatTile label="Exact scores" value={String(exactHits)} accent="text-emerald-600" />
        <StatTile label="Outcome accuracy" value={`${accuracyPct}%`} accent="text-blue-600" />
        <StatTile label="Matches scored" value={`${scored.length}/${totalAvailable}`} accent="text-neutral-600" />
      </div>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 bg-white p-3">
      <span className={`text-xl font-bold tabular-nums ${accent}`}>{value}</span>
      <span className="text-xs text-neutral-500">{label}</span>
    </div>
  );
}

// ============================================================================
// Matches kicking off in the next 24 hours
// ============================================================================

function TodaysMatches({
  upcomingMatches,
  teamNames,
  participantId,
  myPredictions,
}: {
  upcomingMatches: Match[];
  teamNames: Map<string, string>;
  participantId: string;
  myPredictions: Map<string, MatchPrediction>;
}) {
  if (upcomingMatches.length === 0) return null;
  const unpredictedCount = upcomingMatches.filter((m) => !myPredictions.has(m.id)).length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Kicking off in the next 24 hours
        </h2>
        {unpredictedCount > 0 ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
            {unpredictedCount} unpredicted
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-600">
            All predicted
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {upcomingMatches.map((match) => (
          <MatchPredictionCard
            key={match.id}
            match={match}
            teamNames={teamNames}
            participantId={participantId}
            existing={myPredictions.get(match.id) ?? null}
          />
        ))}
      </div>
    </section>
  );
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

  const allGroupStageFinished = matches.every(
    (m) => m.round !== "Group Stage" || m.status === "finished"
  );

  const availableCount = allGroupStageFinished
    ? matches.filter((m) => m.round === "Group Stage" || teamsConfirmed(m)).length
    : matches.filter((m) => m.round === "Group Stage").length;

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const upcomingMatches = matches.filter((m) => {
    if (m.status !== "scheduled" || !m.team1_id || !m.team2_id) return false;
    const kickoff = new Date(m.kickoff_at);
    return kickoff >= now && kickoff <= in24h;
  });

  const filteredMatches = filterMatches(matches, filterGroup, filterSearch, teamNames);
  const grouped = groupByRound(filteredMatches);
  const submittedCount = myPredictions.size;
  const pct = availableCount > 0 ? Math.round((submittedCount / availableCount) * 100) : 0;

  // myPredictions is pre-enriched by getMyMatchPredictions(): finished matches
  // already have points_awarded and score_breakdown computed from live scores.
  // Filter to finished-match predictions only for the stats / banner.
  const allMyPredictions: MatchPrediction[] = Array.from(myPredictions.values())
    .filter((p) => p.points_awarded !== null);
  const matchPoints = allMyPredictions.reduce((sum, p) => sum + (p.points_awarded ?? 0), 0);

  // Count unsubmitted knockout predictions so the banner can tell participants
  // whether they still need to act.
  const knockoutWithTeams = matches.filter(
    (m) => m.round !== "Group Stage" && m.team1_id && m.team2_id
  );
  const unpredictedKnockout = knockoutWithTeams.filter((m) => !myPredictions.has(m.id)).length;

  return (
    <div className="flex flex-col gap-8">
      <ScoreBanner currentPoints={matchPoints} participantId={participant.id} />

      {allGroupStageFinished && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-800">
            🏆 Knockout stage predictions are open!
          </p>
          <p className="mt-0.5 text-xs text-emerald-700">
            All group stage matches are finished. Scroll down to predict the Round of 32 onwards.
            {unpredictedKnockout > 0
              ? ` You have ${unpredictedKnockout} knockout match${unpredictedKnockout === 1 ? "" : "es"} left to predict.`
              : " You've predicted every confirmed match — nice work."}
          </p>
        </div>
      )}

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
              <span className="shrink-0 text-xs font-semibold text-emerald-600">All done</span>
            )}
          </div>
        </div>
        <Link
          href="/predictions/categories"
          className="shrink-0 rounded-xl bg-pitch px-5 py-3 text-sm font-bold text-gold shadow-md transition-opacity hover:opacity-90"
        >
          Favourite Teams &amp; Awards
        </Link>
      </div>

      <PersonalStats predictions={allMyPredictions} totalAvailable={availableCount} />

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="mb-3 text-sm font-semibold">How scoring works</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm">
            <div className="font-semibold text-emerald-700">Perfect call</div>
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
        <p className="mt-2 text-xs text-neutral-400">Tiers do not stack — you score the single highest tier you qualify for.</p>
      </div>

      <TodaysMatches
        upcomingMatches={upcomingMatches}
        teamNames={teamNames}
        participantId={participant.id}
        myPredictions={myPredictions}
      />

      <FilterBar activeGroup={filterGroup} activeSearch={filterSearch} />

      {DISPLAY_ROUND_ORDER.map((round) => {
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
