import { notFound } from "next/navigation";
import Link from "next/link";
import { flagForTeam } from "@/lib/flags";
import { getMatches, getTeamNameMap } from "@/lib/data";
import {
  getParticipantById,
  getParticipantMatchPredictions,
  getLeaderboard,
} from "@/lib/predictions";
import { ROUND_ORDER, groupByRound, sortMatchesForDisplay, RANK_MEDALS, isKnockoutRound } from "@/lib/match-utils";
import type { Match, MatchPrediction } from "@/lib/types";

export const revalidate = 0;

// ── Colour coding ─────────────────────────────────────────────────────────────
// Green=exact(5), Blue=goal diff(3), Yellow=W/D/L(1), Red=wrong(0)

type PickTier = "exact_score" | "goal_diff" | "outcome" | "wrong" | "pending";

function pickTier(pick: MatchPrediction): PickTier {
  if (pick.points_awarded === null || !pick.score_breakdown) return "pending";
  if (pick.score_breakdown.exact_score) return "exact_score";            // 5 pts
  if (pick.score_breakdown.correct_goal_difference) return "goal_diff";  // 3 pts
  if (pick.score_breakdown.correct_outcome) return "outcome";            // 2 pts
  return "wrong";                                                         // 0 pts
}

const TIER_CLASS: Record<PickTier, string> = {
  exact_score: "border-emerald-400 bg-emerald-50",
  goal_diff:   "border-blue-300 bg-blue-50",
  outcome:     "border-yellow-300 bg-yellow-50",
  wrong:       "border-red-300 bg-red-50",
  pending:     "border-neutral-200 bg-white",
};

const TIER_LABEL: Record<PickTier, string> = {
  exact_score: "🎯 Perfect call — exact scoreline (5 pts)",
  goal_diff:   "Sharp eye — right result + goal margin (3 pts)",
  outcome:     "Called it — right result W/D/L (2 pts)",
  wrong:       "Missed this one (0 pts)",
  pending:     "Not yet played",
};

// Knockout matches can't end in a draw, so the 2pt tier means "called the
// winner" rather than "called W/D/L" — swap in accurate copy for the title
// tooltip on those cards.
function tierLabel(tier: PickTier, isKnockout: boolean): string {
  if (tier === "outcome" && isKnockout) return "Called it — picked the winner (2 pts)";
  return TIER_LABEL[tier];
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ParticipantPage({
  params,
}: {
  params: { id: string };
}) {
  const [participant, predictions, allMatches, teamNames, leaderboard] =
    await Promise.all([
      getParticipantById(params.id),
      getParticipantMatchPredictions(params.id),
      getMatches(),
      getTeamNameMap(),
      getLeaderboard(),
    ]);

  if (!participant) notFound();

  // Build lookup maps
  const matchById = new Map<string, Match>(allMatches.map((m) => [m.id, m]));
  const predByMatchId = new Map<string, MatchPrediction>(
    predictions.map((p) => [p.match_id, p])
  );

  const lbRow = leaderboard.find((r) => r.participant_id === params.id);
  const rank = lbRow?.rank ?? null;
  const totalPoints = lbRow?.total_points ?? 0;

  // Group matches by round (only include rounds the participant has a pick for,
  // OR the round has matches in the schedule — show all rounds), then sort each
  // round so incomplete matches (live/scheduled) surface before finished ones.
  const byRound = groupByRound(allMatches);
  for (const [round, roundMatches] of byRound) {
    byRound.set(round, sortMatchesForDisplay(roundMatches));
  }

  // Summary counts (4 tiers)
  const scored = predictions.filter((p) => p.points_awarded !== null);
  const exactCount    = scored.filter((p) => p.score_breakdown?.exact_score).length;
  const goalDiffCount = scored.filter((p) => p.score_breakdown?.correct_goal_difference && !p.score_breakdown.exact_score).length;
  const outcomeCount  = scored.filter((p) => p.score_breakdown?.correct_outcome && !p.score_breakdown.correct_goal_difference).length;
  const wrongCount    = scored.filter((p) => !p.score_breakdown?.correct_outcome).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* Back link */}
      <Link href="/leaderboard" className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-pitch">
        ← Leaderboard
      </Link>

      {/* Header */}
      <div className="mb-6 mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{participant.display_name}</h1>
          {rank && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-neutral-500">
              {RANK_MEDALS[rank] ? <span className="text-xl leading-none">{RANK_MEDALS[rank]}</span> : `#${rank}`}
              <span>· {totalPoints} pts</span>
            </p>
          )}
        </div>
        {scored.length > 0 && (
          <div className="flex flex-wrap gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border border-emerald-400 bg-emerald-200" />
              {exactCount} exact
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border border-blue-300 bg-blue-200" />
              {goalDiffCount} goal diff
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border border-yellow-300 bg-yellow-200" />
              {outcomeCount} W/D/L
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border border-red-300 bg-red-200" />
              {wrongCount} wrong
            </span>
          </div>
        )}
      </div>

      {/* Predictions by round */}
      <div className="flex flex-col gap-8">
        {ROUND_ORDER.map((round) => {
          const roundMatches = byRound.get(round) ?? [];
          if (roundMatches.length === 0) return null;

          // Only show rounds where the participant has at least one pick,
          // OR the round has started (at least one match is not "scheduled")
          const hasPick = roundMatches.some((m) => predByMatchId.has(m.id));
          const hasStarted = roundMatches.some((m) => m.status !== "scheduled");
          if (!hasPick && !hasStarted) return null;

          return (
            <section key={round}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
                {round}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {roundMatches.map((match) => {
                  const pick = predByMatchId.get(match.id);
                  const team1 = match.team1_id
                    ? (teamNames.get(match.team1_id) ?? match.team1_code)
                    : match.team1_code;
                  const team2 = match.team2_id
                    ? (teamNames.get(match.team2_id) ?? match.team2_code)
                    : match.team2_code;
                  const flag1 = flagForTeam(team1);
                  const flag2 = flagForTeam(team2);
                  const hasResult =
                    match.home_score !== null && match.away_score !== null;
                  const tier = pick ? pickTier(pick) : "pending";

                  return (
                    <div
                      key={match.id}
                      className={`rounded-xl border px-3 py-2.5 text-xs shadow-sm ${pick ? TIER_CLASS[tier] : "border-neutral-100 bg-neutral-50 opacity-60"}`}
                      title={pick ? tierLabel(tier, isKnockoutRound(match.round)) : "No prediction submitted"}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-neutral-400">
                        <span>#{match.match_number}</span>
                        {match.status === "live" && (
                          <span className="badge bg-red-100 text-red-700">LIVE</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-neutral-700">
                          {flag1 && `${flag1} `}{team1} vs {flag2 && `${flag2} `}{team2}
                        </span>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          {pick ? (
                            <>
                              <span className="font-mono font-semibold tabular-nums text-neutral-900">
                                {pick.predicted_home}–{pick.predicted_away}
                                {isKnockoutRound(match.round) && pick.predicted_winner_side && (
                                  <span className="ml-1 font-sans text-[10px] font-normal text-neutral-400">
                                    ({pick.predicted_winner_side === "team1" ? match.team1_code : match.team2_code} W)
                                  </span>
                                )}
                              </span>
                              {hasResult && (
                                <span className="text-neutral-400">
                                  final {match.home_score}–{match.away_score}
                                </span>
                              )}
                              {pick.points_awarded !== null && (
                                <span className={`badge font-semibold ${
                                  tier === "exact_score" ? "bg-emerald-100 text-emerald-700" :
                                  tier === "goal_diff"   ? "bg-blue-100 text-blue-700" :
                                  tier === "outcome"     ? "bg-yellow-100 text-yellow-700" :
                                  tier === "wrong"       ? "bg-red-100 text-red-500" :
                                  "bg-neutral-100 text-neutral-400"
                                }`}>
                                  +{pick.points_awarded} pts
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="italic text-neutral-400">no pick</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
