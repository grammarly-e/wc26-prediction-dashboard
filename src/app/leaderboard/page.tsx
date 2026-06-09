import Link from "next/link";

import { getLastSyncedAt, getMatches, getTeamNameMap } from "@/lib/data";
import {
  getCurrentParticipant,
  getLeaderboard,
  getStageLeaderboards,
  getVisibleMatchPredictionsByParticipant,
  type StageLeaderboardRow,
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

// ----------------------------------------------------------------------------
// Award-pick accuracy — "who called the Champion / Golden Boot best?"
//
// Deliberately a placeholder for now: tournament_predictions.points_awarded
// is never written (scoreTournamentPrediction exists in scoring.ts but no
// resolution job calls it), and these categories genuinely can't resolve
// until their real-world outcome is known — Champion only once the Final
// final whistle blows, Golden Boot shortly after as scoring gets confirmed.
// Building "live tracking" here would mean guessing at outcomes mid-tournament,
// which is exactly the kind of fragile gimmick worth avoiding. Shipping the
// section now (clearly marked pending) sets user expectations correctly and
// means the real ranking can slot in here later with no layout change.
// ----------------------------------------------------------------------------

function AwardAccuracyCard({ label, description }: { label: string; description: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="text-lg font-bold text-neutral-400">Not decided yet</p>
      <p className="text-xs text-neutral-500">{description}</p>
    </div>
  );
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

export default async function LeaderboardPage() {
  const [rows, participant, lastSynced, stageLeaderboards, breakdowns, matches, teamNames] = await Promise.all([
    getLeaderboard(),
    getCurrentParticipant(),
    getLastSyncedAt(),
    getStageLeaderboards(),
    getVisibleMatchPredictionsByParticipant(),
    getMatches(),
    getTeamNameMap(),
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

  // Match #104 is the Final — its kickoff date is the natural "this resolves
  // around..." anchor for the award-pick placeholder cards below.
  const finalMatch = matches.find((m) => m.match_number === 104) ?? null;
  const finalDateLabel = finalMatch
    ? new Date(finalMatch.kickoff_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : "the Final";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Ranked by match prediction points, with exact-scoreline calls as the tiebreaker. Tournament
            award picks are scored separately and don&rsquo;t affect this ranking. Click a participant to see
            their match-by-match breakdown — picks for matches that haven&rsquo;t kicked off yet stay hidden
            for everyone. Updates automatically as results come in.
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

      <div>
        <h2 className="mb-1 text-sm font-semibold text-neutral-700">Award pick accuracy</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Who called the Champion and Golden Boot best? These can&rsquo;t be scored until the real outcomes are known —
          rankings will appear here once they&rsquo;re decided.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <AwardAccuracyCard
            label="Champion pick"
            description={`Resolves once the Champion is crowned — expected after the Final on ${finalDateLabel}.`}
          />
          <AwardAccuracyCard
            label="Golden Boot pick"
            description={`Resolves once the tournament's top scorer is confirmed, shortly after the Final on ${finalDateLabel}.`}
          />
        </div>
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
        <LeaderboardTable
          rows={tableRows}
          currentParticipantId={participant?.id ?? null}
          breakdowns={breakdowns}
          matches={matchById}
          teamNames={teamNames}
        />
      )}
    </div>
  );
}
