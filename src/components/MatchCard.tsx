import StatusBadge from "./StatusBadge";
import { flagForTeam } from "@/lib/flags";
import { isKnockoutRound } from "@/lib/match-utils";
import type { Match, MatchEvent } from "@/lib/types";
import type { ConsensusData } from "@/lib/data";
import type { MatchInsight, MatchPredictionReveal } from "@/lib/predictions";

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
    timeZoneName: "short",
  });
}

// ── Shock result helpers ──────────────────────────────────────────────────────

function consensusOutcome(c: ConsensusData): "home" | "draw" | "away" {
  if (c.home_win_count >= c.draw_count && c.home_win_count >= c.away_win_count) return "home";
  if (c.away_win_count > c.draw_count && c.away_win_count > c.home_win_count) return "away";
  return "draw";
}

function actualOutcome(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MatchCard({
  match,
  teamNames,
  consensus,
  insight,
  forceNamesTBD,
  events,
  allPredictions,
}: {
  match: Match;
  teamNames: Map<string, string>;
  consensus?: ConsensusData;
  insight?: MatchInsight;
  forceNamesTBD?: boolean;
  events?: MatchEvent[];
  allPredictions?: MatchPredictionReveal[];
}) {
  const team1 = forceNamesTBD ? "TBD" : (match.team1_id ? teamNames.get(match.team1_id) ?? match.team1_code : match.team1_code);
  const team2 = forceNamesTBD ? "TBD" : (match.team2_id ? teamNames.get(match.team2_id) ?? match.team2_code : match.team2_code);
  const hasScore = match.home_score !== null && match.away_score !== null;
  const isPlaceholder = forceNamesTBD || !match.team1_id || !match.team2_id;
  const flag1 = forceNamesTBD ? null : flagForTeam(team1);
  const flag2 = forceNamesTBD ? null : flagForTeam(team2);

  const isFinished = match.status === "finished";

  // Show consensus prediction bars on finished matches with enough data
  const showReveal = isFinished && hasScore && consensus && consensus.total >= 3;

  // Show individual predictions on any finished match that has predictions
  const showIndividual = isFinished && allPredictions && allPredictions.length > 0;

  // Show goal scorers on finished matches with goal events
  const showGoals = isFinished && events && events.length > 0;

  // Shock result: consensus was >= 60% one way but actual result went the other way.
  // Requires at least 4 predictions to avoid noise with tiny groups.
  const SHOCK_THRESHOLD = 0.6;
  const shockInfo = (() => {
    if (!isFinished || !hasScore || !consensus || consensus.total < 4) return null;
    const cOutcome = consensusOutcome(consensus);
    const aOutcome = actualOutcome(match.home_score!, match.away_score!);
    if (cOutcome === aOutcome) return null;
    const cCount =
      cOutcome === "home" ? consensus.home_win_count :
      cOutcome === "away" ? consensus.away_win_count :
      consensus.draw_count;
    const pct = cCount / consensus.total;
    if (pct < SHOCK_THRESHOLD) return null;
    const label =
      cOutcome === "home"
        ? (team1.length > 12 ? "a home win" : team1)
        : cOutcome === "away"
        ? (team2.length > 12 ? "an away win" : team2)
        : "a draw";
    return { pct: Math.round(pct * 100), label };
  })();

  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          #{match.match_number} &middot; {match.round}
          {match.group_letter ? ` · Group ${match.group_letter}` : ""}
        </span>
        <StatusBadge status={match.status} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className={`flex flex-1 items-center justify-end gap-2 text-right font-medium ${isPlaceholder ? "text-neutral-400 italic" : ""}`}>
          {team1}
          {flag1 && <span aria-hidden="true">{flag1}</span>}
        </span>
        <span className="min-w-[64px] rounded-lg bg-neutral-100 px-3 py-1 text-center font-mono text-lg font-bold tabular-nums">
          {hasScore ? `${match.home_score} – ${match.away_score}` : "vs"}
        </span>
        <span className={`flex flex-1 items-center gap-2 font-medium ${isPlaceholder ? "text-neutral-400 italic" : ""}`}>
          {flag2 && <span aria-hidden="true">{flag2}</span>}
          {team2}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>{formatKickoff(match.kickoff_at)}</span>
        <span>{match.host_city ?? match.venue}</span>
      </div>

      {/* Shock result flag */}
      {shockInfo && (
        <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          <span aria-hidden="true">{"⚡"}</span>
          <span>{shockInfo.pct}% tipped {shockInfo.label} — shock result</span>
        </div>
      )}

      {/* Pre-kickoff consensus summary (scheduled matches only) */}
      {match.status === "scheduled" && consensus && consensus.total > 0 && (
        <div className="border-t border-neutral-100 pt-2 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">{consensus.total} {consensus.total === 1 ? "pick" : "picks"}</span>
          {" — "}
          {Math.round((consensus.home_win_count / consensus.total) * 100)}% home
          {" · "}
          {Math.round((consensus.draw_count / consensus.total) * 100)}% draw
          {" · "}
          {Math.round((consensus.away_win_count / consensus.total) * 100)}% away
        </div>
      )}

      {/* Goal scorers */}
      {showGoals && events && (
        <div className="border-t border-neutral-100 pt-2">
          <div className="flex flex-col gap-0.5">
            {events.map((e) => {
              const suffix =
                e.event_type === "own_goal"
                  ? " (OG)"
                  : e.event_type === "penalty_goal"
                  ? " (pen)"
                  : "";
              return (
                <div key={e.id} className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <span className="w-7 shrink-0 text-right font-mono text-neutral-400">
                    {e.minute != null ? `${e.minute}'` : ""}
                  </span>
                  <span aria-hidden="true">{"⚽"}</span>
                  <span>{(e.player_name ?? "Unknown") + suffix}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Post-result consensus bars */}
      {showReveal && consensus && (
        <div className="border-t border-neutral-100 pt-2 text-xs text-neutral-500">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-neutral-600">Group predicted</span>
            <span className="text-neutral-400">{consensus.total} {consensus.total === 1 ? "pick" : "picks"}</span>
          </div>
          <div className="flex gap-2">
            <OutcomeBar
              label={team1.length > 10 ? "Home" : team1}
              count={consensus.home_win_count}
              total={consensus.total}
              color="bg-pitch"
            />
            <OutcomeBar
              label="Draw"
              count={consensus.draw_count}
              total={consensus.total}
              color="bg-neutral-300"
            />
            <OutcomeBar
              label={team2.length > 10 ? "Away" : team2}
              count={consensus.away_win_count}
              total={consensus.total}
              color="bg-neutral-500"
            />
          </div>
          {insight && insight.exact_score_count > 0 && (
            <p className="mt-1.5 text-xs text-emerald-600">
              {"🎯"} {insight.exact_score_count} {insight.exact_score_count === 1 ? "person" : "people"} nailed the exact score
            </p>
          )}
          {insight && insight.exact_score_count === 0 && insight.total_predictions > 0 && (
            <p className="mt-1.5 text-xs text-neutral-400">Nobody called the exact score</p>
          )}
        </div>
      )}

      {/* Per-participant prediction reveal */}
      {showIndividual && allPredictions && (
        <details className="border-t border-neutral-100 pt-2 text-xs">
          <summary className="cursor-pointer select-none list-none text-neutral-500 hover:text-neutral-700 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1">
              <span className="text-neutral-400">{"▶"}</span>
              <span>Who predicted what</span>
              <span className="text-neutral-400">({allPredictions.length})</span>
            </span>
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            {allPredictions.map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="text-neutral-600">{p.display_name}</span>
                <span
                  className={`font-mono tabular-nums ${
                    p.exact_score
                      ? "font-semibold text-emerald-600"
                      : p.correct_outcome
                      ? "text-blue-500"
                      : p.points_awarded !== null
                      ? "text-neutral-400"
                      : "text-neutral-500"
                  }`}
                >
                  {p.predicted_home}-{p.predicted_away}
                  {isKnockoutRound(match.round) && p.predicted_winner_side && (
                    <span className="ml-1 text-[10px] font-normal text-neutral-400">
                      ({p.predicted_winner_side === "team1" ? match.team1_code : match.team2_code} W)
                    </span>
                  )}
                  {p.exact_score && <span className="ml-1">{"🎯"}</span>}
                  {!p.exact_score && p.correct_outcome && <span className="ml-1 text-blue-400">{"✓"}</span>}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function OutcomeBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex flex-1 flex-col gap-0.5">
      <div className="flex justify-between text-[10px] text-neutral-500">
        <span className="truncate">{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
