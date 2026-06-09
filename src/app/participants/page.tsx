import Link from "next/link";
import { getLeaderboard } from "@/lib/predictions";
import { getCurrentParticipant } from "@/lib/predictions";

export const revalidate = 0;

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default async function ParticipantsPage() {
  const [rows, me] = await Promise.all([
    getLeaderboard(),
    getCurrentParticipant(),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Participants</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Click any name to see their full prediction sheet — including picks for upcoming matches.
        </p>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3 font-semibold">Rank</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 text-right font-semibold">Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isMe = me?.id === row.participant_id;
              return (
                <tr
                  key={row.participant_id}
                  className={`border-b border-neutral-100 last:border-0 transition hover:bg-neutral-50 ${isMe ? "bg-gold/10" : ""}`}
                >
                  <td className="px-4 py-3 font-mono text-neutral-500">
                    {MEDALS[row.rank] ?? row.rank}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/participants/${row.participant_id}`}
                      className="inline-flex items-center gap-2 hover:text-pitch hover:underline"
                    >
                      {row.display_name}
                      {isMe && <span className="badge bg-pitch text-gold">You</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                    {row.total_points}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-neutral-400">
                  No participants yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
