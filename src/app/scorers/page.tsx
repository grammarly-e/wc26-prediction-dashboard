import { getTopScorers } from "@/lib/data";
import { RANK_MEDALS } from "@/lib/match-utils";

export const revalidate = 0;

export default async function ScorersPage() {
  const scorers = await getTopScorers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Top Scorers — Golden Boot Race</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ranked by goals scored. Use this to inform your Golden Boot pick. Updates automatically each sync.
        </p>
      </div>

      {scorers.length === 0 ? (
        <div className="card flex flex-col gap-2 p-6 text-center">
          <p className="text-sm font-medium text-neutral-600">No goal data yet</p>
          <p className="text-xs text-neutral-400">
            Scorer stats populate once group-stage matches kick off (June 11).
            Data comes from football-data.org, backed up by ESPN.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-neutral-400">
              <tr className="border-b border-neutral-100">
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Player</th>
                <th className="px-3 py-2 text-left font-medium">Team</th>
                <th className="px-3 py-2 text-center font-medium" title="Goals">G</th>
                <th className="px-3 py-2 text-center font-medium" title="Assists">A</th>
              </tr>
            </thead>
            <tbody>
              {scorers.map((s) => (
                <tr
                  key={s.id}
                  className={`border-b border-neutral-50 last:border-0 ${
                    s.rank && s.rank <= 3 ? "bg-gold/10 font-medium" : "hover:bg-neutral-50"
                  }`}
                >
                  <td className="px-3 py-2 tabular-nums text-neutral-400">
                    {s.rank && RANK_MEDALS[s.rank] ? (
                      <span className="text-xl leading-none">{RANK_MEDALS[s.rank]}</span>
                    ) : (
                      s.rank ?? "—"
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">{s.player_name}</td>
                  <td className="px-3 py-2 text-neutral-500">{s.team_name ?? "—"}</td>
                  <td className="px-3 py-2 text-center font-bold tabular-nums">{s.goals}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-neutral-500">{s.assists}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-neutral-100 px-3 py-2 text-right text-xs text-neutral-400">
            Source: football-data.org / ESPN
          </p>
        </div>
      )}
    </div>
  );
}
