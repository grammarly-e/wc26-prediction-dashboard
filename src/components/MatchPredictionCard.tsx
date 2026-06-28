"use client";

// ============================================================================
// One match, with an editable scoreline prediction.
//
// Locking rule mirrors the database (supabase/migrations/0002_*): once
// `kickoff_at` passes, this flips from an editable form to a read-only
// summary of what was submitted (or a "you missed this one" note) — backed
// up server-side by RLS, which refuses writes after kickoff regardless of
// what the UI does. The UI lock is just for a clean experience; the DB lock
// is what actually matters.
// ============================================================================

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { flagForTeam } from "@/lib/flags";
import { SCORING } from "@/lib/scoring";
import { hasKickedOff, isKnockoutRound } from "@/lib/match-utils";
import StatusBadge from "./StatusBadge";
import type { Match, MatchPrediction, WinnerSide } from "@/lib/types";

/** Auto-default for the winner toggle: whichever side is ahead on the
 *  entered scoreline. Returns null on a tie or incomplete entry, since
 *  knockout matches can't end level, so a tied 90-minutes-+-stoppage-time
 *  scoreline (settled in extra time or on penalties) always needs an
 *  explicit manual pick. */
function leadingSide(homeStr: string, awayStr: string): WinnerSide | null {
  if (homeStr === "" || awayStr === "") return null;
  const home = Number(homeStr);
  const away = Number(awayStr);
  if (!Number.isInteger(home) || !Number.isInteger(away)) return null;
  if (home > away) return "team1";
  if (away > home) return "team2";
  return null;
}

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Singapore",
    timeZoneName: "short",
  });
}

/**
 * "Locks in 2d 4h" / "Locks in 45m" — a relative countdown alongside the
 * absolute kickoff time. Absolute time is what you'd actually plan around;
 * relative time is what makes "I should do this soon" land emotionally.
 * Computed at render time (no ticking interval) — close enough for a value
 * that only matters down to the minute, and avoids re-render churn across
 * 100+ cards on the page.
 */
function formatCountdown(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `locks in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `locks in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `locks in ${days}d ${hours % 24}h`;
}

/** Colors the points badge by which scoring tier it landed in — lets you
 * scan a long list of results and immediately see your hits vs. misses. */
function tierBadgeClass(points: number): string {
  if (points >= SCORING.EXACT_SCORE) return "bg-emerald-100 text-emerald-700";
  if (points >= SCORING.RESULT_AND_GOAL_DIFF) return "bg-blue-100 text-blue-700";
  if (points >= SCORING.RESULT_ONLY) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-500";
}

interface Props {
  match: Match;
  teamNames: Map<string, string>;
  participantId: string;
  existing: MatchPrediction | null;
}

export default function MatchPredictionCard({ match, teamNames, participantId, existing }: Props) {
  const team1 = match.team1_id ? teamNames.get(match.team1_id) ?? match.team1_code : match.team1_code;
  const team2 = match.team2_id ? teamNames.get(match.team2_id) ?? match.team2_code : match.team2_code;
  const isPlaceholder = !match.team1_id || !match.team2_id;
  const flag1 = flagForTeam(team1);
  const flag2 = flagForTeam(team2);
  const locked = hasKickedOff(match);

  const countdown = locked ? null : formatCountdown(match.kickoff_at);

  const [home, setHome] = useState(existing ? String(existing.predicted_home) : "");
  const [away, setAway] = useState(existing ? String(existing.predicted_away) : "");
  const isKnockout = isKnockoutRound(match.round);
  const [winnerSide, setWinnerSide] = useState<WinnerSide | null>(existing?.predicted_winner_side ?? null);
  // Once the participant manually picks a winner, stop auto-defaulting it
  // from the scoreline inputs. See leadingSide() above and the onChange
  // handlers below.
  const [winnerSideTouched, setWinnerSideTouched] = useState(existing?.predicted_winner_side != null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const h = Number(home);
    const a = Number(away);
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 99 || a > 99) {
      setError("Enter a whole number (0 or higher) for each team.");
      setStatus("error");
      return;
    }
    if (isKnockout && !winnerSide) {
      setError("Pick who wins. A draw isn't a valid final outcome for a knockout match.");
      setStatus("error");
      return;
    }
    if (isKnockout && winnerSide) {
      const decisive = leadingSide(home, away);
      if (decisive && decisive !== winnerSide) {
        setError("Your winner pick doesn't match the scoreline you entered. Update one so they agree.");
        setStatus("error");
        return;
      }
    }

    setStatus("saving");
    setError(null);
    const supabase = createClient();
    const { error: upsertError } = await supabase
      .from("match_predictions")
      .upsert(
        {
          participant_id: participantId,
          match_id: match.id,
          predicted_home: h,
          predicted_away: a,
          predicted_winner_side: isKnockout ? winnerSide : null,
        },
        { onConflict: "participant_id,match_id" }
      );

    if (upsertError) {
      setStatus("error");
      setError(
        upsertError.code === "42501"
          ? "This match has already kicked off — picks are locked."
          : "Couldn't save your prediction. Try again."
      );
      return;
    }

    setStatus("saved");
    router.refresh();
  }

  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          #{match.match_number} · {match.round}
          {match.group_letter ? ` · Group ${match.group_letter}` : ""}
        </span>
        <StatusBadge status={match.status} />
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className={`flex flex-1 items-center justify-end gap-2 text-right font-medium ${isPlaceholder ? "text-neutral-400 italic" : ""}`}>
          {team1}
          {flag1 && <span aria-hidden="true">{flag1}</span>}
        </span>
        <span className="text-xs text-neutral-400">vs</span>
        <span className={`flex flex-1 items-center gap-2 font-medium ${isPlaceholder ? "text-neutral-400 italic" : ""}`}>
          {flag2 && <span aria-hidden="true">{flag2}</span>}
          {team2}
        </span>
      </div>

      <p className="flex items-center gap-2 text-xs text-neutral-500">
        <span>{formatKickoff(match.kickoff_at)}</span>
        {countdown && <span className="badge bg-pitch/10 text-pitch">{countdown}</span>}
      </p>

      {locked ? (
        <LockedSummary match={match} existing={existing} />
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          {isKnockout && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-neutral-500">Winner:</span>
              <button
                type="button"
                onClick={() => {
                  setWinnerSide("team1");
                  setWinnerSideTouched(true);
                  setStatus("idle");
                }}
                className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                  winnerSide === "team1"
                    ? "bg-pitch text-gold"
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                }`}
              >
                {flag1 && <span aria-hidden="true">{flag1} </span>}
                {team1}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWinnerSide("team2");
                  setWinnerSideTouched(true);
                  setStatus("idle");
                }}
                className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                  winnerSide === "team2"
                    ? "bg-pitch text-gold"
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                }`}
              >
                {flag2 && <span aria-hidden="true">{flag2} </span>}
                {team2}
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              value={home}
              onChange={(e) => {
                const v = e.target.value;
                setHome(v);
                setStatus("idle");
                if (isKnockout && !winnerSideTouched) setWinnerSide(leadingSide(v, away));
              }}
              placeholder="–"
              aria-label={`Predicted score for ${team1}`}
              className="w-14 rounded-lg border border-neutral-300 px-2 py-1.5 text-center font-mono text-sm focus:border-pitch focus:outline-none"
            />
            <span className="text-neutral-400">–</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              value={away}
              onChange={(e) => {
                const v = e.target.value;
                setAway(v);
                setStatus("idle");
                if (isKnockout && !winnerSideTouched) setWinnerSide(leadingSide(home, v));
              }}
              placeholder="–"
              aria-label={`Predicted score for ${team2}`}
              className="w-14 rounded-lg border border-neutral-300 px-2 py-1.5 text-center font-mono text-sm focus:border-pitch focus:outline-none"
            />
            {isKnockout && (
              <span className="text-[11px] text-neutral-400">90 min + stoppage time only</span>
            )}
            <button
              type="submit"
              disabled={status === "saving" || home === "" || away === ""}
              className="ml-auto rounded-lg bg-pitch px-3 py-1.5 text-xs font-semibold text-gold transition hover:opacity-90 disabled:opacity-50"
            >
              {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : existing ? "Update" : "Save"}
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Read-only view shown once a match has kicked off — picks can no longer
 * change. Always shows the final score once it's known (mirrors MatchCard),
 * even if you never submitted a pick — "what happened" is information you
 * want regardless of whether you played.
 */
function LockedSummary({ match, existing }: { match: Match; existing: MatchPrediction | null }) {
  const hasResult = match.home_score !== null && match.away_score !== null;
  const finalScore = hasResult ? (
    <span className="font-mono font-semibold text-neutral-900">
      {match.home_score}–{match.away_score}
    </span>
  ) : (
    <span className="text-neutral-400">not played yet</span>
  );

  if (!existing) {
    return (
      <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-xs">
        <span className="text-neutral-500">
          You didn&rsquo;t lock in a pick before kickoff. Final: {finalScore}
        </span>
        <span className="badge bg-neutral-100 text-neutral-400">no pick</span>
      </div>
    );
  }

  const winnerCode = existing.predicted_winner_side === "team1"
    ? match.team1_code
    : existing.predicted_winner_side === "team2"
    ? match.team2_code
    : null;

  return (
    <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-xs">
      <span className="text-neutral-600">
        Your pick:{" "}
        <span className="font-mono font-semibold text-neutral-900">
          {existing.predicted_home}–{existing.predicted_away}
        </span>
        {winnerCode && isKnockoutRound(match.round) && <> ({winnerCode} to win)</>}
        {" "}· Final: {finalScore}
      </span>
      {existing.points_awarded !== null && (
        <span className={`badge ${tierBadgeClass(existing.points_awarded)}`}>
          +{existing.points_awarded} pts
        </span>
      )}
    </div>
  );
}
