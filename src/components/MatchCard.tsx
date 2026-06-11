import StatusBadge from "./StatusBadge";
import { flagForTeam } from "@/lib/flags";
import type { Match } from "@/lib/types";
import type { ConsensusData } from "@/lib/data";
import type { MatchInsight } from "@/lib/predictions";

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function MatchCard({
  match,
  teamNames,
  consensus,
  insight,
  forceNamesTBD,
}: {
  match: Match;
  teamNames: Map<string, string>;
  consensus?: ConsensusData;
  insight?: MatchInsight;
  forceNamesTBD?: boolean;
}) {
  const team1 = forceNamesTBD ? "TBD" : (match.team1_id ? teamNames.get(match.team1_id) ?? match.team1_code : match.team1_code);
  const team2 = forceNamesTBD ? "TBD" : (match.team2_id ? teamNames.get(match.team2_id) ?? match.team2_code : match.team2_code);
  const hasScore = match.home_score !== null && match.away_score !== null;
  const isPlaceholder = forceNamesTBD || !match.team1_id || !match.team2_id;
  const flag1 = forceNamesTBD ? null : flagForTeam(team1);
  const flag2 = forceNamesTBD ? null : flagForTeam(team2);

  const showReveal =
    match.status === "finished" &&
    hasScore &&
    consensus &&
    consensus.total >= 3;

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
