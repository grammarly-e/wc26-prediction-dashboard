import { getStandingsByGroup, type GroupStanding } from "@/lib/data";
import { flagForTeam } from "@/lib/flags";

export const revalidate = 0;

const GROUP_LETTERS = "ABCDEFGHIJKL".split("");

function GroupTable({ letter, rows }: { letter: string; rows: GroupStanding[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-neutral-200 bg-pitch px-4 py-2 font-bold text-white">Group {letter}</div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">Group lineup not yet confirmed.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-neutral-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Team</th>
                <th className="px-2 py-2 text-center font-medium" title="Played">P</th>
                <th className="px-2 py-2 text-center font-medium" title="Won">W</th>
                <th className="px-2 py-2 text-center font-medium" title="Drawn">D</th>
                <th className="px-2 py-2 text-center font-medium" title="Lost">L</th>
                <th className="px-2 py-2 text-center font-medium" title="Goal difference">GD</th>
                <th className="px-3 py-2 text-center font-medium" title="Points">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const flag = flagForTeam(row.team_name);
                return (
                  <tr key={row.id} className={i < 2 ? "bg-pitch/5 font-medium" : ""}>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        {flag && <span aria-hidden="true">{flag}</span>}
                        {row.team_name}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">{row.played}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{row.won}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{row.drawn}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{row.lost}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}</td>
                    <td className="px-3 py-2 text-center font-bold tabular-nums">{row.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.every((r) => r.played === 0) && (
            <p className="border-t border-neutral-100 px-3 py-2 text-xs text-neutral-400">
              No matches played yet — standings update automatically once Matchday 1 kicks off.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default async function StandingsPage() {
  const byGroup = await getStandingsByGroup();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Group Standings</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Top two in each group (highlighted) advance to the Round of 32. Updates live as matches finish.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {GROUP_LETTERS.map((letter) => (
          <GroupTable key={letter} letter={letter} rows={byGroup.get(letter) ?? []} />
        ))}
      </div>
    </div>
  );
}
