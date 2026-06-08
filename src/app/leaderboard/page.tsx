import { getCurrentParticipant, getLeaderboard } from "@/lib/predictions";

export const revalidate = 0;

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default async function LeaderboardPage() {
  const [rows, participant] = await Promise.all([getLeaderboard(), getCurrentParticipant()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Ranked by total points (match picks + tournament award picks), with exact-scoreline calls as the
          tiebreaker. Updates automatically as results come in.
        </p>
      </div>

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
