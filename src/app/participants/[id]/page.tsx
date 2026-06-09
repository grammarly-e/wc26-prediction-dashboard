import { notFound } from "next/navigation";
import Link from "next/link";
import { flagForTeam } from "@/lib/flags";
import { getMatches, getTeamNameMap } from "@/lib/data";
import {
  getParticipantById,
  getParticipantMatchPredictions,
  getLeaderboard,
} from "@/lib/predictions";
import type { Match, MatchPrediction } from "@/lib/types";

export const revalidate = 0;

// ── Colour coding ─────────────────────────────────────────────────────────────

type PickTier = "best" | "correct" | "wrong" | "pending";

function pickTier(pick: MatchPrediction): PickTier {
  if (pick.points_awarded === null || !pick.score_breakdown) return "pending";
  if (pick.score_breakdown.correct_goal_difference) return "best";   // 3 pts
  if (pick.score_breakdown.correct_outcome) return "correct";        // 1 pt
  return "wrong";                                                     // 0 pts
}

const TIER_CLASS: Record<PickTier, string> = {
  best:    "border-gold/50 bg-gold/10",
  correct: "border-emerald-300 bg-emerald-50",
  wrong:   "border-red-200 bg-red-50",
  pending: "border-neutral-200 bg-white",
};

const TIER_LABEL: Record<PickTier, string> = {
  best:    "Correct result + goal diff (3 pts)",
  correct: "Right result (1 pt)",
  wrong:   "Wrong call (0 pts)",
  pending: "Not yet played",
};

const ROUND_ORDER = [
  "Group Stage",
  "Round of 32",
  "Round of 16",
  "Quarter-final",
  "Semi-final",
  "Match for third place",
  "Final",
] as const;

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

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
  // OR the round has matches in the schedule — show all rounds)
  const byRound = new Map<string, Match[]>();
  for (const round of ROUND_ORDER) byRound.set(round, []);
  for (const m of allMatches) {
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }

  // Summary counts
  const scored = predictions.filter((p) => p.points_awarded !== null);
  const bestCount  = scored.filter((p) => p.score_breakdown?.correct_goal_difference).length;
  const rightCount = scored.filter((p) => p.score_breakdown?.correct_outcome && !p.score_breakdown.correct_goal_difference).length;
  const wrongCount = scored.filter((p) => !p.score_breakdown?.correct_outcome).length;

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
            <p className="mt-0.5 text-sm text-neutral-500">
              {MEDALS[rank] ?? `#${rank}`} · {totalPoints} pts
            </p>
          )}
        </div>
        {scored.length > 0 && (
          <div className="flex gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border border-gold/50 bg-gold/30" />
              {bestCount} best
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full border border-emerald-300 bg-emerald-200" />
              {rightCount} right
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
                      title={pick ? TIER_LABEL[tier] : "No prediction submitted"}
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
                              </span>
                              {hasResult && (
                                <span className="text-neutral-400">
                                  final {match.home_score}–{match.away_score}
                                </span>
                              )}
                              {pick.points_awarded !== null && (
                                <span className={`badge font-semibold ${
                                  tier === "best"    ? "bg-gold/30 text-pitch" :
                                  tier === "correct" ? "bg-emerald-100 text-emerald-700" :
                                  "bg-neutral-100 text-neutral-500"
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
