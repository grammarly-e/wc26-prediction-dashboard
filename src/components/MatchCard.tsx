import StatusBadge from "./StatusBadge";
import type { Match } from "@/lib/types";

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

/** A single match: teams, score (or kickoff time if not yet played), status. */
export default function MatchCard({ match, teamNames }: { match: Match; teamNames: Map<string, string> }) {
  const team1 = match.team1_id ? teamNames.get(match.team1_id) ?? match.team1_code : match.team1_code;
  const team2 = match.team2_id ? teamNames.get(match.team2_id) ?? match.team2_code : match.team2_code;
  const hasScore = match.home_score !== null && match.away_score !== null;
  const isPlaceholder = !match.team1_id || !match.team2_id;

  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          #{match.match_number} · {match.round}
          {match.group_letter ? ` · Group ${match.group_letter}` : ""}
        </span>
        <StatusBadge status={match.status} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className={`flex-1 text-right font-medium ${isPlaceholder ? "text-neutral-400 italic" : ""}`}>
          {team1}
        </span>
        <span className="min-w-[64px] rounded-lg bg-neutral-100 px-3 py-1 text-center font-mono text-lg font-bold tabular-nums">
          {hasScore ? `${match.home_score} – ${match.away_score}` : "vs"}
        </span>
        <span className={`flex-1 font-medium ${isPlaceholder ? "text-neutral-400 italic" : ""}`}>{team2}</span>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>{formatKickoff(match.kickoff_at)}</span>
        <span>
          {match.host_city ?? match.venue}
        </span>
      </div>
    </div>
  );
}
