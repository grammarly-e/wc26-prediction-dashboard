import Link from "next/link";

import { getLastSyncedAt } from "@/lib/data";
import { getCurrentParticipant, getLeaderboard } from "@/lib/predictions";

export const revalidate = 0;

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "no data synced yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function LeaderboardPage() {
  const [rows, participant, lastSynced] = await Promise.all([
    getLeaderboard(),
    getCurrentParticipant(),
    getLastSyncedAt(),
  ]);
  const myRow = participant ? rows.find((r) => r.participant_id === participant.id) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Ranked by total points (match picks + tournament award picks), with exact-scoreline calls as the
            tiebreaker. Updates automatically as results come in.
          </p>
        </div>
        <span className="badge shrink-0 bg-neutral-100 text-neutral-500" title={lastSynced ?? undefined}>
          Live data synced {formatSyncedAt(lastSynced)}
        </span>
      </div>

      {myRow && (
        <div className="card flex flex-wrap items-center gap-x-8 gap-y-2 bg-pitch p-4 text-gold">
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Your standing</p>
            <p className="text-lg font-bold">
              {MEDALS[myRow.rank] ?? `#${myRow.rank}`} of {rows.length}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Total points</p>
            <p className="text-lg font-bold tabular-nums">{myRow.total_points}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Match · Award</p>
            <p className="text-lg font-bold tabular-nums">
              {myRow.match_points} · {myRow.tournament_points}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Exact calls</p>
            <p className="text-lg font-bold tabular-nums">{myRow.exact_score_hits}</p>
          </div>
          <Link href="/predictions" className="ml-auto text-xs font-semibold underline-offset-2 hover:underline">
            Add more picks →
          </Link>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">
          Nobody&rsquo;s on the board yet —{" "}
          <a href="/predictions" className="font-semibold text-pitch hover:underline">
            be the first to make your predictions
          </a>
          .
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3 font-semibold">Rank</th>
                <th className="px-4 py-3 font-semibold">Participant</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 text-right font-semibold">Match pts</th>
                <th className="px-4 py-3 text-right font-semibold">Award pts</th>
                <th className="px-4 py-3 text-right font-semibold">Exact calls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isMe = participant?.id === row.participant_id;
                return (
                  <tr
                    key={row.participant_id}
                    className={`border-b border-neutral-100 last:border-0 ${isMe ? "bg-gold/10" : ""}`}
                  >
                    <td className="px-4 py-3 font-mono text-neutral-500">
                      {MEDALS[row.rank] ?? row.rank}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {row.display_name}
                      {isMe && <span className="badge ml-2 bg-pitch text-gold">You</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">{row.total_points}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">
                      {row.match_points}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">
                      {row.tournament_points}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600">
                      {row.exact_score_hits}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
