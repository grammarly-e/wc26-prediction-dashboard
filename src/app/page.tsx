import MatchCard from "@/components/MatchCard";
import FilterBar from "@/components/FilterBar";
import { flagForTeam } from "@/lib/flags";
import {
  getLastSyncedAt,
  getMatchConsensus,
  getMatchEvents,
  getMatches,
  getTeamNameMap,
} from "@/lib/data";
import {
  getFinishedMatchPredictions,
  getMatchInsights,
  type MatchInsight,
} from "@/lib/predictions";
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

const MIN_INSIGHT_SAMPLE = 3;

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

interface InsightCallout {
  match: Match;
  insight: MatchInsight;
}

function pickInsightCallouts(
  matches: Match[],
  insights: Map<string, MatchInsight>
): { upset: InsightCallout | null; bestRead: InsightCallout | null } {
  const eligible: InsightCallout[] = [];
  for (const match of matches) {
    const insight = insights.get(match.id);
    if (insight && insight.total_predictions >= MIN_INSIGHT_SAMPLE) {
      eligible.push({ match, insight });
    }
  }
  if (eligible.length === 0) return { upset: null, bestRead: null };

  let lowest = eligible[0];
  let highest = eligible[0];
  for (const entry of eligible) {
    if (entry.insight.correct_outcome_rate < lowest.insight.correct_outcome_rate) lowest = entry;
    if (entry.insight.correct_outcome_rate > highest.insight.correct_outcome_rate) highest = entry;
  }

  // Only label a match an upset if fewer than 30% predicted the correct outcome.
  const UPSET_THRESHOLD = 0.3;
  const isUpset = lowest.insight.correct_outcome_rate < UPSET_THRESHOLD;

  if (lowest.match.id === highest.match.id) {
    return isUpset ? { upset: lowest, bestRead: null } : { upset: null, bestRead: lowest };
  }

  return { upset: isUpset ? lowest : null, bestRead: highest };
}

function InsightCard({
  label,
  tone,
  callout,
  teamNames,
}: {
  label: string;
  tone: "upset" | "bestRead";
  callout: InsightCallout;
  teamNames: Map<string, string>;
}) {
  const { match, insight } = callout;
  const team1 = match.team1_id ? teamNames.get(match.team1_id) ?? match.team1_code : match.team1_code;
  const team2 = match.team2_id ? teamNames.get(match.team2_id) ?? match.team2_code : match.team2_code;
  const flag1 = flagForTeam(team1);
  const flag2 = flagForTeam(team2);
  const pct = Math.round(insight.correct_outcome_rate * 100);
  const toneClasses = tone === "upset" ? "border-red-200 bg-red-50" : "border-emerald-300 bg-emerald-50";
  const accentClasses = tone === "upset" ? "text-red-700" : "text-emerald-700";
  const summary =
    tone === "upset"
      ? `Only ${insight.correct_outcome_count} of ${insight.total_predictions} predictions (${pct}%) called the right result.`
      : `${insight.correct_outcome_count} of ${insight.total_predictions} predictions (${pct}%) called the right result.`;

  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border p-4 shadow-sm ${toneClasses}`}>
      <span className={`text-xs font-semibold uppercase tracking-wide ${accentClasses}`}>{label}</span>
      <span className="text-sm text-neutral-500">#{match.match_number} &middot; {match.round}</span>
      <span className="text-base font-semibold text-neutral-900">
        {flag1 ? `${flag1} ` : ""}{team1} {match.home_score}-{match.away_score} {flag2 ? `${flag2} ` : ""}{team2}
      </span>
      <span className="text-xs text-neutral-600">{summary}</span>
      {insight.exact_score_count > 0 && (
        <span className="text-xs text-neutral-500">
          {insight.exact_score_count} {insight.exact_score_count === 1 ? "person" : "people"} nailed the exact scoreline.
        </span>
      )}
    </div>
  );
}

function SyncFooter({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  return (
    <p className="mt-4 text-center text-xs text-neutral-400">
      {lastSyncedAt
        ? `Live data last synced ${new Date(lastSyncedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} · source: football-data.org`
        : "No live data synced yet -- run `npm run sync` once FOOTBALL_DATA_API_KEY is configured."}
      {" "}This page updates automatically as new data arrives.
    </p>
  );
}

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: { group?: string; q?: string };
}) {
  const filterGroup = searchParams.group ?? null;
  const filterSearch = (searchParams.q ?? "").trim();

  const [allMatches, teamNames, insights, lastSyncedAt] = await Promise.all([
    getMatches(),
    getTeamNameMap(),
    getMatchInsights(),
    getLastSyncedAt(),
  ]);

  // Fetch consensus for ALL matches -- scheduled ones show the pre-kickoff split;
  // finished ones reveal how the group called it after the result.
  const allMatchIds = allMatches.map((m) => m.id);
  const finishedMatchIds = allMatches.filter((m) => m.status === "finished").map((m) => m.id);

  const [consensus, events, allPredictions] = await Promise.all([
    getMatchConsensus(allMatchIds),
    getMatchEvents(finishedMatchIds),
    getFinishedMatchPredictions(finishedMatchIds),
  ]);

  const groupStageMatches = allMatches.filter((m) => m.round === "Group Stage");
  const groupStageComplete =
    groupStageMatches.length > 0 && groupStageMatches.every((m) => m.status === "finished");

  const liveMatches = allMatches.filter((m) => m.status === "live");
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  const recentResults = allMatches
    .filter((m) => m.status === "finished" && Date.now() - new Date(m.kickoff_at).getTime() <= TWO_DAYS_MS)
    .sort((a, b) => new Date(b.kickoff_at).getTime() - new Date(a.kickoff_at).getTime())
    .slice(0, 6);

  const { upset, bestRead } = pickInsightCallouts(allMatches, insights);

  const scheduleMatches = filterMatches(allMatches, filterGroup, filterSearch, teamNames);
  const grouped = groupByRound(scheduleMatches);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">World Cup 2026 -- Matches</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Live scores, results, and the full schedule -- {allMatches.length} matches in total.
          Upcoming matches show how participants are collectively predicting them.
        </p>
      </div>

      {liveMatches.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">
            Live now <span className="font-normal text-neutral-400">({liveMatches.length})</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {liveMatches.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                teamNames={teamNames}
                consensus={consensus.get(m.id)}
                insight={insights.get(m.id)}
                events={events.get(m.id)}
                allPredictions={allPredictions.get(m.id)}
              />
            ))}
          </div>
        </section>
      )}

      {recentResults.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">Latest results</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {recentResults.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                teamNames={teamNames}
                consensus={consensus.get(m.id)}
                insight={insights.get(m.id)}
                events={events.get(m.id)}
                allPredictions={allPredictions.get(m.id)}
              />
            ))}
          </div>
        </section>
      )}

      {(upset || bestRead) && !filterGroup && !filterSearch && (
        <div className={`grid gap-3 ${upset && bestRead ? "sm:grid-cols-2" : "sm:max-w-md"}`}>
          {upset && <InsightCard label="Biggest Upset" tone="upset" callout={upset} teamNames={teamNames} />}
          {bestRead && <InsightCard label="Best Read" tone="bestRead" callout={bestRead} teamNames={teamNames} />}
        </div>
      )}

      <section className="flex flex-col gap-6">
        <div>
          <h2 className="mb-3 text-lg font-bold">Full schedule</h2>
          <FilterBar activeGroup={filterGroup} activeSearch={filterSearch} />
        </div>

        {scheduleMatches.length === 0 ? (
          <p className="card p-4 text-sm text-neutral-500">No matches found for this filter.</p>
        ) : (
          ROUND_ORDER.map((round) => {
            const roundMatches = grouped.get(round) ?? [];
            if (roundMatches.length === 0) return null;
            return (
              <div key={round}>
                <h3 className="mb-3 font-semibold text-neutral-700">
                  {round} <span className="font-normal text-neutral-400">({roundMatches.length})</span>
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {roundMatches.map((m) => (
                    <MatchCard
                      key={m.id}
                      match={m}
                      teamNames={teamNames}
                      consensus={consensus.get(m.id)}
                      insight={insights.get(m.id)}
                      events={events.get(m.id)}
                      allPredictions={allPredictions.get(m.id)}
                      forceNamesTBD={round === "Round of 32" && !groupStageComplete}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </section>

      <SyncFooter lastSyncedAt={lastSyncedAt} />
    </div>
  );
}
