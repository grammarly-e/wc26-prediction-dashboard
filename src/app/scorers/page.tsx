import { getTopScorers } from "@/lib/data";

export const revalidate = 0;

export default async function ScorersPage() {
  const scorers = await getTopScorers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Top Scorers — Golden Boot Race</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ranked by goals (assists as tiebreaker context). Feeds the Golden Boot tournament prediction category.
        </p>
      </div>

      {scorers.length === 0 ? (
        <p className="card p-4 text-sm text-neutral-500">
          No scorer data yet — football-data.org typically populates this once group-stage matches are underway.
        </p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-neutral-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Player</th>
                <th className="px-3 py-2 text-left font-medium">Team</th>
                <th className="px-3 py-2 text-center font-medium">Goals</th>
                <th className="px-3 py-2 text-center font-medium">Assists</th>
              </tr>
            </thead>
            <tbody>
              {scorers.map((s) => (
                <tr key={s.id} className={s.rank && s.rank <= 3 ? "bg-gold/10 font-medium" : ""}>
                  <td className="px-3 py-2 tabular-nums">{s.rank ?? "—"}</td>
                  <td className="px-3 py-2">{s.player_name}</td>
                  <td className="px-3 py-2 text-neutral-500">{s.team_name ?? "—"}</td>
                  <td className="px-3 py-2 text-center font-bold tabular-nums">{s.goals}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{s.assists}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
