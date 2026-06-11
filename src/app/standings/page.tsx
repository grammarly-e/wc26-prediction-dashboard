import { getStandingsByGroup, getKnockoutMatches, getTeamNameMap, type GroupStanding } from "@/lib/data";
import { flagForTeam } from "@/lib/flags";
import type { Match } from "@/lib/types";

export const revalidate = 0;

const GROUP_LETTERS = "ABCDEFGHIJKL".split("");

/** Prefer DB-stored flag_emoji; fall back to name-based lookup for any team not yet populated. */
function resolveFlag(row: GroupStanding): string | null {
  if (row.flag_emoji) return row.flag_emoji;
  return flagForTeam(row.team_name);
}

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
                const flag = resolveFlag(row);
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

// ── Knockout Bracket ──────────────────────────────────────────────────────────────────────────────────────

function teamLabel(teamId: string | null, teamNames: Map<string, string>, code: string): string {
  if (!teamId) return "TBD";
  return teamNames.get(teamId) ?? code;
}

function BracketSlot({
  match,
  teamNames,
  showTBD,
  side,
}: {
  match: Match | undefined;
  teamNames: Map<string, string>;
  showTBD: boolean;
  /** "left" = team1 on top, "right" = team2 on top */
  side: "left" | "right";
}) {
  if (showTBD || !match) {
    return (
      <div className="flex flex-col rounded border border-neutral-200 bg-neutral-50 text-[11px]">
        <div className="border-b border-neutral-200 px-2 py-1 text-neutral-400">TBD</div>
        <div className="px-2 py-1 text-neutral-400">TBD</div>
      </div>
    );
  }

  const t1 = teamLabel(match.team1_id, teamNames, match.team1_code);
  const t2 = teamLabel(match.team2_id, teamNames, match.team2_code);
  const f1 = flagForTeam(t1);
  const f2 = flagForTeam(t2);
  const hasScore = match.home_score !== null && match.away_score !== null;
  const finished = match.status === "finished";
  const live = match.status === "live";

  // Winner bolded, loser dimmed
  const isWinner1 = finished && hasScore && match.home_score! > match.away_score!;
  const isWinner2 = finished && hasScore && match.away_score! > match.home_score!;

  const topIsTeam1 = side === "left";
  const topTeam = topIsTeam1 ? t1 : t2;
  const topFlag = topIsTeam1 ? f1 : f2;
  const topScore = topIsTeam1 ? match.home_score : match.away_score;
  const topWins = topIsTeam1 ? isWinner1 : isWinner2;

  const botTeam = topIsTeam1 ? t2 : t1;
  const botFlag = topIsTeam1 ? f2 : f1;
  const botScore = topIsTeam1 ? match.away_score : match.home_score;
  const botWins = topIsTeam1 ? isWinner2 : isWinner1;

  const topClass = `flex items-center justify-between gap-1 border-b border-neutral-200 px-2 py-1 text-[11px] ${
    topWins ? "font-bold text-pitch" : finished ? "text-neutral-400" : "text-neutral-700"
  }`;
  const botClass = `flex items-center justify-between gap-1 px-2 py-1 text-[11px] ${
    botWins ? "font-bold text-pitch" : finished ? "text-neutral-400" : "text-neutral-700"
  }`;

  const borderClass = finished
    ? "border-neutral-300 bg-white"
    : live
    ? "border-emerald-400 bg-emerald-50"
    : "border-neutral-200 bg-neutral-50";

  return (
    <div className={`flex flex-col rounded border text-[11px] ${borderClass}`}>
      <div className={topClass}>
        <span className="flex min-w-0 items-center gap-1">
          {topFlag && <span>{topFlag}</span>}
          <span className="truncate">{topTeam}</span>
        </span>
        {hasScore && <span className="shrink-0 font-mono tabular-nums">{topScore}</span>}
      </div>
      <div className={botClass}>
        <span className="flex min-w-0 items-center gap-1">
          {botFlag && <span>{botFlag}</span>}
          <span className="truncate">{botTeam}</span>
        </span>
        {hasScore && <span className="shrink-0 font-mono tabular-nums">{botScore}</span>}
      </div>
    </div>
  );
}

// Bracket layout (left side, top to bottom):
//   R32 pairs → R16:  [73,75]→90  [74,77]→89  [76,78]→91  [79,80]→92
//   R16 pairs → QF:   [90,89]→97  [91,92]→99
//   QF pair → SF:     [97,99]→101
//   SF left: 101 (W97 v W98)  — note W98 comes from right QF (cross-bracket SF)
//
// Right side (mirrored):
//   R32 pairs → R16:  [83,84]→93  [81,82]→94  [86,88]→95  [85,87]→96
//   R16 pairs → QF:   [93,94]→98  [95,96]→100
//   QF pair → SF:     [98,100]→102
//   SF right: 102 (W99 v W100)
//
// Center: Final #104 (W101 v W102), 3rd place #103 (L101 v L102)

function ConnectorV({
  count,
  side,
}: {
  count: number;
  side: "left" | "right";
}) {
  // Creates bracket fork connectors. "left" uses border-r; "right" uses border-l.
  const topEdge = side === "left" ? "border-r border-t" : "border-l border-t";
  const botEdge = side === "left" ? "border-r border-b" : "border-l border-b";
  return (
    <div className="flex flex-col" style={{ width: "12px" }}>
      <div className="invisible text-[10px]">x</div>
      <div className="flex flex-1 flex-col">
        {Array.from({ length: count }).map((_, g) => (
          <div key={g} className="flex flex-1 flex-col">
            <div className={`flex flex-1 items-end border-neutral-300 ${topEdge}`} />
            <div className={`flex flex-1 items-start border-neutral-300 ${botEdge}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectorH({ side }: { side: "left" | "right" }) {
  // Single horizontal connector (SF → Final).
  // For left: right border. For right: left border.
  const cls = side === "left" ? "border-r border-neutral-300" : "border-l border-neutral-300";
  return (
    <div className="flex flex-col" style={{ width: "12px" }}>
      <div className="invisible text-[10px]">x</div>
      <div className={`flex flex-1 items-center ${cls}`} />
    </div>
  );
}

function RoundCol({
  title,
  nums,
  flex,
  byNum,
  teamNames,
  showTBD,
  side,
}: {
  title: string;
  nums: number[];
  flex: number;
  byNum: Map<number, Match>;
  teamNames: Map<string, string>;
  showTBD: boolean;
  side: "left" | "right";
}) {
  return (
    <div className="flex flex-col" style={{ minWidth: "9rem" }}>
      <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </div>
      <div className="flex flex-1 flex-col">
        {nums.map((num, i) => (
          <div key={i} className="flex items-center" style={{ flex }}>
            <div className="w-full px-0.5">
              <BracketSlot
                match={byNum.get(num)}
                teamNames={teamNames}
                showTBD={showTBD}
                side={side}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnockoutBracket({
  matches,
  teamNames,
  showTBD,
}: {
  matches: Match[];
  teamNames: Map<string, string>;
  showTBD: boolean;
}) {
  const byNum = new Map<number, Match>(matches.map((m) => [m.match_number, m]));

  // Left half (R32 reordered so adjacent pairs feed the same R16 slot)
  const leftR32 = [73, 75, 74, 77, 76, 78, 79, 80];
  const leftR16 = [90, 89, 91, 92];
  const leftQF  = [97, 99];

  // Right half (mirrored order)
  const rightQF  = [98, 100];
  const rightR16 = [93, 94, 95, 96];
  const rightR32 = [83, 84, 81, 82, 86, 88, 85, 87];

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex" style={{ minWidth: "max-content", height: "28rem" }}>

        {/* ──── Left side: R32 → R16 → QF → SF ──── */}
        <div className="flex gap-1">
          <RoundCol title="Round of 32" nums={leftR32} flex={1} byNum={byNum} teamNames={teamNames} showTBD={showTBD} side="left" />
          <ConnectorV count={4} side="left" />
          <RoundCol title="Round of 16" nums={leftR16} flex={2} byNum={byNum} teamNames={teamNames} showTBD={showTBD} side="left" />
          <ConnectorV count={2} side="left" />
          <RoundCol title="Quarter-final" nums={leftQF} flex={4} byNum={byNum} teamNames={teamNames} showTBD={showTBD} side="left" />
          <ConnectorV count={1} side="left" />
          <RoundCol title="Semi-final" nums={[101]} flex={8} byNum={byNum} teamNames={teamNames} showTBD={showTBD} side="left" />
          <ConnectorH side="left" />
        </div>

        {/* ──── Center: Final + 3rd place ──── */}
        <div className="flex flex-col" style={{ minWidth: "9.5rem" }}>
          <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            Final
          </div>
          <div className="flex flex-1 flex-col justify-center gap-3">
            <BracketSlot match={byNum.get(104)} teamNames={teamNames} showTBD={showTBD} side="left" />
            <div className="text-center text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              3rd Place
            </div>
            <BracketSlot match={byNum.get(103)} teamNames={teamNames} showTBD={showTBD} side="left" />
          </div>
        </div>

        {/* ──── Right side: SF ← QF ← R16 ← R32 ────
             flex-row-reverse: last DOM item appears leftmost.
             ConnectorH is last → appears leftmost (adjacent to center). */}
        <div className="flex flex-row-reverse gap-1">
          <RoundCol title="Round of 32" nums={rightR32} flex={1} byNum={byNum} teamNames={teamNames} showTBD={showTBD} side="right" />
          <ConnectorV count={4} side="right" />
          <RoundCol title="Round of 16" nums={rightR16} flex={2} byNum={byNum} teamNames={teamNames} showTBD={showTBD} side="right" />
          <ConnectorV count={2} side="right" />
          <RoundCol title="Quarter-final" nums={rightQF} flex={4} byNum={byNum} teamNames={teamNames} showTBD={showTBD} side="right" />
          <ConnectorV count={1} side="right" />
          <RoundCol title="Semi-final" nums={[102]} flex={8} byNum={byNum} teamNames={teamNames} showTBD={showTBD} side="right" />
          <ConnectorH side="right" />
        </div>

      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────────────────────────────────

export default async function StandingsPage() {
  const [byGroup, { matches: knockoutMatches, allGroupStageFinished }, teamNames] =
    await Promise.all([
      getStandingsByGroup(),
      getKnockoutMatches(),
      getTeamNameMap(),
    ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Group Standings</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Top two in each group (highlighted) advance automatically. The 8 best 3rd-place finishers
          across all 12 groups also advance. Updates live as matches finish.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {GROUP_LETTERS.map((letter) => (
          <GroupTable key={letter} letter={letter} rows={byGroup.get(letter) ?? []} />
        ))}
      </div>

      <div>
        <h2 className="text-xl font-bold">Knockout Bracket</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {allGroupStageFinished
            ? "Teams and scores fill in as each round is played. Scroll horizontally to see the full bracket."
            : "Bracket slots are confirmed after the group stage concludes. Scroll horizontally to see the full bracket."}
        </p>
      </div>

      <KnockoutBracket
        matches={knockoutMatches}
        teamNames={teamNames}
        showTBD={!allGroupStageFinished}
      />
    </div>
  );
}
