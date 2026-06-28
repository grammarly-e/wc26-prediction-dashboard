import Link from "next/link";

import { getLastSyncedAt, getMatches, getTeamNameMap, getTopScorers } from "@/lib/data";
import {
  getCurrentParticipant,
  getStageLeaderboards,
  getVisibleMatchPredictionsByParticipant,
  getAwardPicks,
  getAllFavouritePicks,
  type StageLeaderboardRow,
  type AwardPickRow,
} from "@/lib/predictions";
import LeaderboardTable from "@/components/LeaderboardTable";
import { RANK_MEDALS } from "@/lib/match-utils";
import type { Match } from "@/lib/types";

export const revalidate = 0;

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "no data synced yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleString("en-SG", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" });
}

// \u2500\u2500 Favourite-team scoring \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

const ROUND_PTS: Record<string, number> = {
  "Round of 16": 1,
  "Quarter-final": 2,
  "Semi-final": 5,
};

function teamFurthestPts(teamId: string, matches: Match[]): number {
  let pts = 0;
  for (const m of matches) {
    if (m.status !== "finished") continue;
    if (m.team1_id !== teamId && m.team2_id !== teamId) continue;
    if (m.round === "Final" && m.home_score != null && m.away_score != null) {
      const isTeam1 = m.team1_id === teamId;
      const won = isTeam1 ? m.home_score > m.away_score : m.away_score > m.home_score;
      pts = Math.max(pts, won ? 20 : 10);
    } else if (m.round in ROUND_PTS) {
      pts = Math.max(pts, ROUND_PTS[m.round]);
    }
  }
  return pts;
}

// \u2500\u2500 Stage leader mini-card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function StageLeaderCard({
  label,
  completedLabel,
  description,
  completedDescription,
  leader,
  points,
  matchesScored,
  isOver,
}: {
  label: string;
  completedLabel: string;
  description: string;
  completedDescription: string;
  leader: StageLeaderboardRow | null;
  points: number;
  matchesScored: number;
  isOver: boolean;
}) {
  const hasStarted = leader !== null && matchesScored > 0;
  const displayLabel = hasStarted && isOver ? completedLabel : label;
  const displayDesc = hasStarted && isOver ? completedDescription : description;
  return (
    <div className="card flex flex-col gap-1 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-400">{displayLabel}</p>
      {hasStarted ? (
        <>
          <p className="text-lg font-bold">
            {leader!.display_name} <span className="font-mono font-normal text-neutral-500">&middot; {points} pts</span>
          </p>
          <p className="text-xs text-neutral-500">{displayDesc}</p>
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

// \u2500\u2500 Award Accuracy Card \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// The name actually shown for a pick — a team name for team-based award
// categories, otherwise the predicted player's name. Shared by the sort
// comparator below and the render loop so the displayed order always matches
// the displayed label.
function pickDisplayName(pick: AwardPickRow, teamNames: Map<string, string>): string {
  return pick.predicted_team_id
    ? (teamNames.get(pick.predicted_team_id) ?? "Unknown team")
    : (pick.predicted_player_name ?? "--");
}

function AwardAccuracyCard({
  label,
  picks,
  teamNames,
  goalsByPlayer,
}: {
  label: string;
  picks: AwardPickRow[];
  teamNames: Map<string, string>;
  goalsByPlayer: Map<string, number>;
}) {
  const anyScored = picks.some((p) => p.points_awarded !== null);

  // Sort picks descending by goals scored (picks with no goal data sort
  // last); ties — including ties on "no data" — break alphabetically by the
  // picked player's (or team's) name, not the participant's.
  const sorted = [...picks].sort((a, b) => {
    const aGoals = a.predicted_player_name ? (goalsByPlayer.get(a.predicted_player_name) ?? -1) : -1;
    const bGoals = b.predicted_player_name ? (goalsByPlayer.get(b.predicted_player_name) ?? -1) : -1;
    if (bGoals !== aGoals) return bGoals - aGoals;
    return pickDisplayName(a, teamNames).localeCompare(pickDisplayName(b, teamNames));
  });

  return (
    <div className="card flex flex-col gap-2 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
      {sorted.length === 0 ? (
        <p className="text-xs text-neutral-400">No picks yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sorted.map((pick) => {
            const name = pickDisplayName(pick, teamNames);
            const goals = pick.predicted_player_name
              ? (goalsByPlayer.get(pick.predicted_player_name) ?? null)
              : null;
            const scored = pick.points_awarded !== null;
            const correct = scored && (pick.points_awarded ?? 0) > 0;
            return (
              <li key={pick.participant_id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-neutral-600">{pick.display_name}</span>
                <span
                  className={`font-medium ${
                    !anyScored
                      ? "text-neutral-500"
                      : correct
                      ? "text-emerald-600"
                      : scored
                      ? "text-red-400"
                      : "text-neutral-400"
                  }`}
                >
                  {name}
                  {goals != null && goals > 0 && (
                    <span className="ml-1 font-normal text-neutral-400">({goals}g)</span>
                  )}
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


// \u2500\u2500 Favourites Leaderboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface FavLeaderRow {
  participant_id: string;
  display_name: string;
  total: number;
  detail: Array<{ name: string; pts: number }>;
}

function FavouritesLeaderboard({
  rows,
  tournamentOver,
}: {
  rows: FavLeaderRow[];
  tournamentOver: boolean;
}) {
  if (rows.length === 0) return null;
  const ranked = [...rows].sort((a, b) => b.total - a.total || a.display_name.localeCompare(b.display_name));
  return (
    <section>
      <div className="mb-3">
        <h2 className="font-semibold">Favourites Leaderboard</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Points for how far each participant&rsquo;s 3 favourite teams advance:
          R16 = 1 pt &middot; QF = 2 pts &middot; SF = 5 pts &middot; Runner-up = 10 pts &middot; Champion = 20 pts.
          {!tournamentOver && " Updates live \u2014 totals lock after the Final."}
        </p>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3 font-semibold">Rank</th>
              <th className="px-4 py-3 font-semibold">Participant</th>
              <th className="px-4 py-3 font-semibold">Favourite teams</th>
              <th className="px-4 py-3 text-right font-semibold">Pts</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row, idx) => (
              <tr key={row.participant_id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3 font-mono text-neutral-500">
                  {RANK_MEDALS[idx + 1] ? (
                    <span className="text-xl leading-none">{RANK_MEDALS[idx + 1]}</span>
                  ) : (
                    `#${idx + 1}`
                  )}
                </td>
                <td className="px-4 py-3 font-medium">{row.display_name}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {row.detail.map((d) => (
                      <span
                        key={d.name}
                        className={`badge ${
                          d.pts >= 20
                            ? "bg-gold/30 text-pitch"
                            : d.pts > 0
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        {d.name}{d.pts > 0 ? ` +${d.pts}` : ""}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// \u2500\u2500 Award categories shown as accuracy cards (awards only, not fav slots) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

const AWARD_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "golden_boot",       label: "Golden Boot" },
  { key: "golden_ball",       label: "Golden Ball" },
  { key: "best_young_player", label: "Best Young Player" },
];

// \u2500\u2500 Page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export default async function LeaderboardPage() {
  // getCurrentParticipant() is awaited up front (not inside the Promise.all
  // below) because getVisibleMatchPredictionsByParticipant() needs the
  // viewer's id to know whose future-match picks are allowed through the
  // kickoff gate -- see its doc comment in predictions.ts.
  const participant = await getCurrentParticipant();

  const [lastSynced, stageLeaderboards, breakdowns, matches, teamNames, allFavPicks, topScorers, ...awardPicksArrays] =
    await Promise.all([
      getLastSyncedAt(),
      getStageLeaderboards(),
      getVisibleMatchPredictionsByParticipant(participant?.id ?? null),
      getMatches(),
      getTeamNameMap(),
      getAllFavouritePicks(),
      getTopScorers(),
      ...AWARD_CATEGORIES.map((c) => getAwardPicks(c.key)),
    ]);

  // Two fully independent rankings — no combined "total points" concept on
  // this page. Index-based rank here is a lightweight summary for the
  // personal banner only; the tables below compute their own tie-aware rank.
  const myGroupIndex = participant
    ? stageLeaderboards.groupStage.findIndex((r) => r.participant_id === participant.id)
    : -1;
  const myKnockoutIndex = participant
    ? stageLeaderboards.knockout.findIndex((r) => r.participant_id === participant.id)
    : -1;
  const myGroupRow = myGroupIndex >= 0 ? stageLeaderboards.groupStage[myGroupIndex] : undefined;
  const myKnockoutRow = myKnockoutIndex >= 0 ? stageLeaderboards.knockout[myKnockoutIndex] : undefined;

  const matchById = new Map(matches.map((m) => [m.id, m]));

  // Build player name -> goals map from top_scorers for award card sorting.
  const goalsByPlayer = new Map<string, number>(
    (topScorers as Array<{ player_name: string; goals: number }>).map((s) => [s.player_name, s.goals])
  );

  // Build per-participant favourite team names for the dropdown
  const allFavPicksMap = new Map<string, string[]>();
  for (const fp of allFavPicks) {
    const names = fp.teamIds
      .map((id) => teamNames.get(id) ?? "Unknown")
      .filter((n) => n !== "Unknown");
    if (names.length > 0) allFavPicksMap.set(fp.participant_id, names);
  }

  // Build Favourites Leaderboard rows
  const teamPtsCache = new Map<string, number>();
  const getTeamPts = (teamId: string) => {
    if (!teamPtsCache.has(teamId)) {
      teamPtsCache.set(teamId, teamFurthestPts(teamId, matches));
    }
    return teamPtsCache.get(teamId)!;
  };

  const favLeaderMap = new Map<string, FavLeaderRow>();
  for (const fp of allFavPicks) {
    const detail = fp.teamIds.map((id) => ({
      name: teamNames.get(id) ?? "Unknown",
      pts: getTeamPts(id),
    }));
    favLeaderMap.set(fp.participant_id, {
      participant_id: fp.participant_id,
      display_name: fp.display_name,
      total: detail.reduce((s, d) => s + d.pts, 0),
      detail,
    });
  }
  const favLeaderRows = Array.from(favLeaderMap.values());

  const tournamentOver = matches.some(
    (m) => m.round === "Final" && m.status === "finished"
  );
  const groupStageMatches = matches.filter((m) => m.round === "Group Stage");
  const allGroupStageFinished =
    groupStageMatches.length > 0 && groupStageMatches.every((m) => m.status === "finished");
  const anyKnockoutPlayed = matches.some(
    (m) => m.round !== "Group Stage" && m.status === "finished"
  );

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
            Two independent rankings: Group Stage and Knockout Stage. Each is scored separately &mdash; 5 pts for exact scoreline, 3 pts for correct goal difference, 2 pts for correct result only. Ties within a stage are broken by W/D/L accuracy, then exact scores. Knockout scorelines are scored on the 90-minute + stoppage-time result only, not extra time or penalties &mdash; the winner pick separately determines who advances.
            Click a row to expand inline, or click a name to see their full prediction sheet.
          </p>
        </div>
        <span className="badge shrink-0 bg-neutral-100 text-neutral-500" title={lastSynced ?? undefined}>
          Live data synced {formatSyncedAt(lastSynced)}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StageLeaderCard
          label="Knockout stage leader"
          completedLabel="Knockout stage winner"
          description="Most match-prediction points from the Round of 32 through the Final (matches #73-104)."
          completedDescription={"Final tally \u2014 tournament is complete."}
          leader={knockoutLeader}
          points={knockoutLeader?.knockout_points ?? 0}
          matchesScored={knockoutMatchesScored}
          isOver={tournamentOver}
        />
        <StageLeaderCard
          label="Group stage leader"
          completedLabel="Group stage winner"
          description="Most match-prediction points across Matchdays 1-17 (matches #1-72)."
          completedDescription={"Final tally \u2014 group stage is complete."}
          leader={groupLeader}
          points={groupLeader?.group_stage_points ?? 0}
          matchesScored={groupMatchesScored}
          isOver={allGroupStageFinished}
        />
      </div>

      {(myGroupRow || myKnockoutRow) && (
        <div className="card flex flex-wrap items-center gap-x-8 gap-y-2 bg-pitch p-4 text-gold">
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Your standing</p>
            <p className="text-lg font-bold">{participant?.display_name}</p>
          </div>
          {myKnockoutRow && (
            <div>
              <p className="text-xs uppercase tracking-wide text-gold/70">Knockout stage</p>
              <p className="text-lg font-bold tabular-nums">
                {RANK_MEDALS[myKnockoutIndex + 1] ?? `#${myKnockoutIndex + 1}`} &middot; {myKnockoutRow.knockout_points} pts
              </p>
            </div>
          )}
          {myGroupRow && (
            <div>
              <p className="text-xs uppercase tracking-wide text-gold/70">Group stage</p>
              <p className="text-lg font-bold tabular-nums">
                {RANK_MEDALS[myGroupIndex + 1] ?? `#${myGroupIndex + 1}`} &middot; {myGroupRow.group_stage_points} pts
              </p>
            </div>
          )}
          <Link href="/predictions" className="ml-auto text-xs font-semibold underline-offset-2 hover:underline">
            Predict scores &rarr;
          </Link>
        </div>
      )}

      {stageLeaderboards.groupStage.length === 0 ? (
        <div className="card p-6 text-center text-sm text-neutral-500">
          Nobody&rsquo;s on the board yet &mdash;{" "}
          <a href="/predictions" className="font-semibold text-pitch hover:underline">
            be the first to make your predictions
          </a>
          .
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <section>
            <h2 className="mb-3 font-semibold">Knockout Stage Leaderboard</h2>
            <LeaderboardTable
              stage="knockout"
              rows={stageLeaderboards.knockout}
              currentParticipantId={participant?.id ?? null}
              breakdowns={breakdowns}
              matches={matchById}
              teamNames={teamNames}
              allFavPicks={allFavPicksMap}
            />
          </section>
          <section>
            <h2 className="mb-3 font-semibold">Group Stage Leaderboard</h2>
            <LeaderboardTable
              stage="group"
              rows={stageLeaderboards.groupStage}
              currentParticipantId={participant?.id ?? null}
              breakdowns={breakdowns}
              matches={matchById}
              teamNames={teamNames}
              allFavPicks={allFavPicksMap}
            />
          </section>
        </div>
      )}

      {anyKnockoutPlayed && <FavouritesLeaderboard rows={favLeaderRows} tournamentOver={tournamentOver} />}

      <section>
        <div className="mb-3">
          <h2 className="font-semibold">Awards picks</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Who everyone called for the Golden Boot, Golden Ball, and Best Young Player.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {AWARD_CATEGORIES.map((cat, i) => (
            <AwardAccuracyCard
              key={cat.key}
              label={cat.label}
              picks={awardPicksArrays[i] as AwardPickRow[]}
              teamNames={teamNames}
              goalsByPlayer={goalsByPlayer}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
