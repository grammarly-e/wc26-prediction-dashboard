import Link from "next/link";

import { getLastSyncedAt, getMatches, getTeamNameMap, getTopScorers, getAwardWinners } from "@/lib/data";
import {
  getCurrentParticipant,
  getStageLeaderboards,
  getVisibleMatchPredictionsByParticipant,
  getAwardPicks,
  getAllFavouritePicks,
  type StageLeaderboardRow,
  type AwardPickRow,
} from "@/lib/predictions";
import CombinedLeaderboard, { type FavRow } from "@/components/CombinedLeaderboard";
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
    if (m.team1_id !== teamId && m.team2_id !== teamId) continue;
    if (m.round === "Final") {
      if (m.status !== "finished" || m.home_score == null || m.away_score == null) continue;
      const isTeam1 = m.team1_id === teamId;
      const won = isTeam1 ? m.home_score > m.away_score : m.away_score > m.home_score;
      pts = Math.max(pts, won ? 20 : 10);
    } else if (m.round in ROUND_PTS) {
      // Credit is earned the moment a team is slotted into this round's
      // match -- team1_id/team2_id only ever resolves to a real team once it
      // has won its way in (resolveSlotCode() in admin-recompute.ts, keyed
      // off the previous round's winner_side). Gating this on the match's
      // own `status === "finished"` (the previous behaviour) meant a team
      // got no credit for reaching a round until it had ALSO finished
      // playing in it -- one full round late, and the reason every favourite
      // showed 0 pts the moment Round of 32 wrapped but before any Round of
      // 16 fixture had been played.
      pts = Math.max(pts, ROUND_PTS[m.round]);
    }
  }
  return pts;
}

/** True once a team has lost a knockout-stage match (Round of 32 onward) --
 *  it can no longer advance any further, regardless of how many points it
 *  banked getting there. Falls back to comparing scores only when
 *  winner_side is missing and the scoreline wasn't level, so a still-
 *  unresolved draw is never mistakenly flagged as an elimination. */
function isTeamEliminated(teamId: string, matches: Match[]): boolean {
  return matches.some((m) => {
    if (m.status !== "finished" || m.round === "Group Stage") return false;
    const isTeam1 = m.team1_id === teamId;
    const isTeam2 = m.team2_id === teamId;
    if (!isTeam1 && !isTeam2) return false;
    if (m.winner_side) {
      const won = (isTeam1 && m.winner_side === "team1") || (isTeam2 && m.winner_side === "team2");
      return !won;
    }
    if (m.home_score != null && m.away_score != null && m.home_score !== m.away_score) {
      const won = isTeam1 ? m.home_score > m.away_score : m.away_score > m.home_score;
      return !won;
    }
    return false;
  });
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
  declaredWinner,
}: {
  label: string;
  picks: AwardPickRow[];
  teamNames: Map<string, string>;
  goalsByPlayer: Map<string, number>;
  declaredWinner?: string;
}) {
  // Sort picks: correct pick first (when winner declared), then by goals scored
  // descending, then alphabetically by predicted name.
  const sorted = [...picks].sort((a, b) => {
    const aName = pickDisplayName(a, teamNames);
    const bName = pickDisplayName(b, teamNames);
    if (declaredWinner) {
      const aCorrect = aName === declaredWinner ? 1 : 0;
      const bCorrect = bName === declaredWinner ? 1 : 0;
      if (bCorrect !== aCorrect) return bCorrect - aCorrect;
    }
    const aGoals = a.predicted_player_name ? (goalsByPlayer.get(a.predicted_player_name) ?? -1) : -1;
    const bGoals = b.predicted_player_name ? (goalsByPlayer.get(b.predicted_player_name) ?? -1) : -1;
    if (bGoals !== aGoals) return bGoals - aGoals;
    return aName.localeCompare(bName);
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
            const isCorrect = declaredWinner != null && name === declaredWinner;
            return (
              <li key={pick.participant_id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-neutral-600">{pick.display_name}</span>
                <span className={`font-medium ${isCorrect ? "text-emerald-600" : "text-neutral-500"}`}>
                  {name}
                  {goals != null && goals > 0 && (
                    <span className="ml-1 font-normal text-neutral-400">({goals}g)</span>
                  )}
                  {isCorrect && <span className="ml-1">✓</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {declaredWinner && (
        <div className="mt-1 border-t border-neutral-100 pt-2">
          <p className="text-xs text-neutral-500">
            Official winner:{" "}
            <span className="font-semibold text-neutral-800">{declaredWinner}</span>
          </p>
        </div>
      )}
    </div>
  );
}


// \u2500\u2500 Favourites Leaderboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500


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

  const [lastSynced, stageLeaderboards, breakdowns, matches, teamNames, allFavPicks, topScorers, awardWinnersRaw, ...awardPicksArrays] =
    await Promise.all([
      getLastSyncedAt(),
      getStageLeaderboards(),
      getVisibleMatchPredictionsByParticipant(participant?.id ?? null),
      getMatches(),
      getTeamNameMap(),
      getAllFavouritePicks(),
      getTopScorers(),
      getAwardWinners(),
      ...AWARD_CATEGORIES.map((c) => getAwardPicks(c.key)),
    ]);

  const awardWinnersMap = new Map(
    (awardWinnersRaw as Array<{ category_key: string; winner_name: string }>).map(
      (w) => [w.category_key, w.winner_name]
    )
  );

  // Personal banner: find this participant's row for their group+knockout totals.
  const myRow = participant
    ? stageLeaderboards.groupStage.find((r) => r.participant_id === participant.id)
    : undefined;

  const matchById = new Map(matches.map((m) => [m.id, m]));

  // Build player name -> goals map from top_scorers for award card sorting.
  const goalsByPlayer = new Map<string, number>(
    (topScorers as Array<{ player_name: string; goals: number }>).map((s) => [s.player_name, s.goals])
  );

  // Build favourite-team scoring for CombinedLeaderboard
  const teamPtsCache = new Map<string, number>();
  const getTeamPts = (teamId: string) => {
    if (!teamPtsCache.has(teamId)) {
      teamPtsCache.set(teamId, teamFurthestPts(teamId, matches));
    }
    return teamPtsCache.get(teamId)!;
  };
  const teamEliminatedCache = new Map<string, boolean>();
  const getTeamEliminated = (teamId: string) => {
    if (!teamEliminatedCache.has(teamId)) {
      teamEliminatedCache.set(teamId, isTeamEliminated(teamId, matches));
    }
    return teamEliminatedCache.get(teamId)!;
  };

  // Plain-object array for the client CombinedLeaderboard prop
  const favRows: FavRow[] = allFavPicks.map((fp) => {
    const detail = fp.teamIds.map((id) => ({
      name: teamNames.get(id) ?? "Unknown",
      pts: getTeamPts(id),
      eliminated: getTeamEliminated(id),
    }));
    return { participant_id: fp.participant_id, fav_pts: detail.reduce((s, d) => s + d.pts, 0), detail };
  });

  const tournamentOver = matches.some((m) => m.round === "Final" && m.status === "finished");
  const groupStageMatches = matches.filter((m) => m.round === "Group Stage");
  const allGroupStageFinished =
    groupStageMatches.length > 0 && groupStageMatches.every((m) => m.status === "finished");

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
            Scoring: 5 pts for exact scoreline, 3 pts for correct goal difference, 2 pts for correct result only. Knockout scorelines are scored on the 90-minute + stoppage-time result only &mdash; the winner pick determines who advances. Use the dropdown to sort by group stage, knockout, or favourite team points (scored separately from match predictions). Click a row to expand, or click a name to see their full prediction sheet.
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

      {myRow && participant && (
        <div className="card flex flex-wrap items-center gap-x-8 gap-y-2 bg-pitch p-4 text-gold">
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Your standing</p>
            <p className="text-lg font-bold">{participant.display_name}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Match pts (total)</p>
            <p className="text-lg font-bold tabular-nums">
              {myRow.group_stage_points + myRow.knockout_points} pts
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Group</p>
            <p className="text-lg font-bold tabular-nums">{myRow.group_stage_points} pts</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gold/70">Knockout</p>
            <p className="text-lg font-bold tabular-nums">{myRow.knockout_points} pts</p>
          </div>
          <Link href="/predictions" className="ml-auto text-xs font-semibold underline-offset-2 hover:underline">
            Predict scores &rarr;
          </Link>
        </div>
      )}

      <section>
        <h2 className="mb-3 font-semibold">Leaderboard</h2>
        <CombinedLeaderboard
          stageRows={stageLeaderboards.groupStage}
          favRows={favRows}
          currentParticipantId={participant?.id ?? null}
          breakdowns={breakdowns}
          matches={matchById}
          teamNames={teamNames}
        />
      </section>

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
              declaredWinner={awardWinnersMap.get(cat.key)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
