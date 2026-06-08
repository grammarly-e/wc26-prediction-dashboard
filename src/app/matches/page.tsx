import MatchCard from "@/components/MatchCard";
import { flagForTeam } from "@/lib/flags";
import { getMatches, getTeamNameMap } from "@/lib/data";
import { getMatchInsights, type MatchInsight } from "@/lib/predictions";
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

// Below this many scored predictions, a match's correct-outcome rate is too
// noisy to call out (e.g. "1 of 1 people got it right" isn't an upset story —
// it's just a small sample). Tune this up once participation grows.
const MIN_INSIGHT_SAMPLE = 3;

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
// "Interesting stats" callouts — Biggest Upset (the finished match where the
// crowd was most often wrong about the result) and Best Read (the one most
// people called correctly). Both draw on getMatchInsights(), which is only
// ever non-empty for matches that have finished (see that function's RLS note),
// so there's nothing here to spoil for matches still in progress.
// ----------------------------------------------------------------------------

interface InsightCallout {
  match: Match;
  insight: MatchInsight;
}

/**
 * Picks the two extremes of correct_outcome_rate among matches with at least
 * MIN_INSIGHT_SAMPLE scored predictions. Returns nulls when nothing yet clears
 * that bar (true for most of the tournament before group-stage results land).
 *
 * When the lowest and highest rates land on the same match — which is exactly
 * what happens when only one match is eligible, or when every eligible match
 * tied — showing it as both "Biggest Upset" and "Best Read" would be a
 * self-contradiction. In that case we show a single callout, framed by
 * whichever story the rate actually supports (crowd mostly wrong vs. mostly
 * right), rather than printing two opposite captions over identical numbers.
 */
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

  if (lowest.match.id === highest.match.id) {
    return lowest.insight.correct_outcome_rate < 0.5
      ? { upset: lowest, bestRead: null }
      : { upset: null, bestRead: lowest };
  }

  return { upset: lowest, bestRead: highest };
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
      ? `Only ${insight.correct_outcome_count} of ${insight.total_predictions} predictions (${pct}%) called the right result — most people got this one wrong.`
      : `${insight.correct_outcome_count} of ${insight.total_predictions} predictions (${pct}%) called the right result — the crowd read this one well.`;

  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border p-4 shadow-sm ${toneClasses}`}>
      <span className={`text-xs font-semibold uppercase tracking-wide ${accentClasses}`}>{label}</span>
      <span className="text-sm text-neutral-500">
        #{match.match_number} · {match.round}
      </span>
      <span className="text-base font-semibold text-neutral-900">
        {flag1 ? `${flag1} ` : ""}
        {team1} {match.home_score}–{match.away_score} {flag2 ? `${flag2} ` : ""}
        {team2}
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

export default async function MatchesPage() {
  const [matches, teamNames, insights] = await Promise.all([getMatches(), getTeamNameMap(), getMatchInsights()]);
  const grouped = groupByRound(matches);
  const { upset, bestRead } = pickInsightCallouts(matches, insights);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Full Schedule</h1>
        <p className="mt-1 text-sm text-neutral-500">
          All {matches.length} matches, grouped by round, in kickoff order. Scores and status update live.
        </p>
      </div>

      {(upset || bestRead) && (
        // Two-column grid only when both callouts exist — a lone card in a
        // 2-col grid leaves an awkward empty cell, so cap its width instead.
        <div className={`grid gap-3 ${upset && bestRead ? "sm:grid-cols-2" : "sm:max-w-md"}`}>
          {upset && <InsightCard label="Biggest Upset" tone="upset" callout={upset} teamNames={teamNames} />}
          {bestRead && <InsightCard label="Best Read" tone="bestRead" callout={bestRead} teamNames={teamNames} />}
        </div>
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
              {roundMatches.map((m) => (
                <MatchCard key={m.id} match={m} teamNames={teamNames} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
