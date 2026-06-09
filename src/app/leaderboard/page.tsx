import Link from "next/link";

import { getLastSyncedAt, getMatches, getTeamNameMap } from "@/lib/data";
import {
  getCurrentParticipant,
  getLeaderboard,
  getStageLeaderboards,
  getVisibleMatchPredictionsByParticipant,
  getAwardPicks,
  type StageLeaderboardRow,
  type AwardPickRow,
} from "@/lib/predictions";
import LeaderboardTable, { type LeaderboardTableRow } from "@/components/LeaderboardTable";

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

function StageLeaderCard({
  label,
  description,
  leader,
  points,
  matchesScored,
}: {
  label: string;
  description: string;
  leader: StageLeaderboardRow | null;
  points: number;
  matchesScored: number;
}) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      {leader && matchesScored > 0 ? (
        <>
          <p className="text-lg font-bold">
            🏆 {leader.display_name} <span className="font-mono font-normal text-neutral-500">· {points} pts</span>
          </p>
          <p className="text-xs text-neutral-500">{description}</p>
        </>
      ) : (
        <>
          <p className="text-lg font-bold text-neutral-400">Not underway yet</p>
          <p className="text-xs text-neutral-500">{description}</p>
        </>
      )}
    </div>
  );
}

// ── Award Accuracy Card ───────────────────────────────────────────────────────

const AWARD_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "champion",          label: "Champion" },
  { key: "runner_up",         label: "Runner-up" },
  { key: "third_place",       label: "3rd Place" },
  { key: "golden_boot",       label: "Golden Boot" },
  { key: "golden_ball",       label: "Golden Ball" },
  { key: "best_young_player", label: "Best Young Player" },
];

function AwardAccuracyCard({
  label,
  picks,
  teamNames,
}: {
  label: string;
  picks: AwardPickRow[];
  teamNames: Map<string, string>;
}) {
  const anyScored = picks.some((p) => p.points_awarded !== null);

  return (
    <div className="card flex flex-col gap-2 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
      {picks.length === 0 ? (
        <p className="text-xs text-neutral-400">No picks yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {picks.map((pick) => {
            const name = pick.predicted_team_id
              ? (teamNames.get(pick.predicted_team_id) ?? "Unknown team")
              : (pick.predicted_player_name ?? "—");
            const scored = pick.points_awarded !== null;
            const correct = scored && (pick.points_awarded ?? 0) > 0;
            return (
              <li key={pick.participant_id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-neutral-600">{pick.display_name}</span>
                <span className={`font-medium ${
                  !anyScored  ? "text-neutral-500" :
                  correct     ? "text-emerald-600" :
                  scored      ? "text-red-400"     :
                                "text-neutral-400"
                }`}>
                  {name}
                  {anyScored && correct && " ✓"}
                  {anyScored && scored && !correct && " ✗"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function LeaderboardPage() {
  const [rows, participant, lastSynced, stageLeaderboards, breakdowns, matches, teamNames, ...awardPicksArrays] =
    await Promise.all([
      getLeaderboard(),
      getCurrentParticipant(),
      getLastSyncedAt(),
      getStageLeaderboards(),
      getVisibleMatchPredictionsByParticipant(),
      getMatches(),
      getTeamNameMap(),
      ...AWARD_CATEGORIES.map((c) => getAwardPicks(c.key)),
    ]);
  const myRow = participant ? rows.find((r) => r.participant_id === participant.id) : undefined;

  const matchById = new Map(matches.map((m) => [m.id, m]));
  const stageById = new Map<string, StageLeaderboardRow>();
  for (const r of [...stageLeaderboards.groupStage, ...stageLeaderboards.knockout]) {
    stageById.set(r.participant_id, r);
  }

  const tableRows: LeaderboardTableRow[] = rows.map((row) => {
    const stage = stageById.get(row.participant_id);
    return {
      participant_id: row.participant_id,
      display_name: row.display_name,
      rank: row.rank,
      total_points: row.total_points,
      match_points: row.match_points,
      tournament_points: row.tournament_points,
      exact_score_hits: row.exact_score_hits,
      group_stage_points: stage?.group_stage_points ?? 0,
      knockout_points: stage?.knockout_points ?? 0,
    };
  });

  const groupLeader = stageLeaderboards.groupStage[0] ?? null;
  const knockoutLeader = stageLeaderboards.knockout[0] ?? null;
  const groupMatchesScored = stageLeaderboards.groupStage.reduce((sum, r) => sum + r.group_stage_matches_scored, 0);
  const knockoutMatchesScored = stageLeaderboards.knockout.reduce((sum, r) => sum + r.knockout_matches_scored, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Ranked by match prediction points. 3 pts for correct result and goal difference, 1 pt for
            correct result only. Best calls (3-pt predictions) break ties. Click a participant to see
            their match-by-match breakdown.
          </p>
        </div>
        <span className="badge shrink-0 bg-neutral-100 text-neutral-500" title={lastSynced ?? undefined}>
          Live data synced {formatSyncedAt(lastSynced)}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StageLeaderCard
          label="Group stage leader"
          description="Most match-prediction points across Matchdays 1–17 (matches #1–72)."
          leader={groupLeader}
          points={groupLeader?.group_stage_points ?? 0}
          matchesScored={groupMatchesScored}
        />
        <StageLeaderCard
          label="Knockout stage leader"
          description="Most match-prediction points from the Round of 32 through the Final (matches #73–104)."
          leader={knockoutLeader}
          points={knockoutLeader?.knockout_points ?? 0}
          matchesScored={knockoutMatchesScored}
        />
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
            <p className="text-xs uppercase tracking-wide text-gold/70">Match points</p>
            <p className="text-lg font-bold tabular-nums">{myRow.match_points}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Best calls</p>
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
        <LeaderboardTable
          rows={tableRows}
          currentParticipantId={participant?.id ?? null}
          breakdowns={breakdowns}
          matches={matchById}
          teamNames={teamNames}
        />
      )}

      {/* Award picks — informational only, no points */}
      <section>
        <div className="mb-3">
          <h2 className="font-semibold">Favourites &amp; Awards picks</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            These don&rsquo;t affect standings — just for fun.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AWARD_CATEGORIES.map((cat, i) => (
            <AwardAccuracyCard
              key={cat.key}
              label={cat.label}
              picks={awardPicksArrays[i] as AwardPickRow[]}
              teamNames={teamNames}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
