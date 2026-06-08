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
import StatusBadge from "./StatusBadge";
import type { Match, MatchPrediction } from "@/lib/types";

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
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
  const locked = new Date(match.kickoff_at).getTime() <= Date.now();

  const [home, setHome] = useState(existing ? String(existing.predicted_home) : "");
  const [away, setAway] = useState(existing ? String(existing.predicted_away) : "");
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

    setStatus("saving");
    setError(null);
    const supabase = createClient();
    const { error: upsertError } = await supabase
      .from("match_predictions")
      .upsert(
        { participant_id: participantId, match_id: match.id, predicted_home: h, predicted_away: a },
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
        <span className={`flex-1 text-right font-medium ${isPlaceholder ? "text-neutral-400 italic" : ""}`}>
          {team1}
        </span>
        <span className="text-xs text-neutral-400">vs</span>
        <span className={`flex-1 font-medium ${isPlaceholder ? "text-neutral-400 italic" : ""}`}>{team2}</span>
      </div>

      <p className="text-xs text-neutral-500">{formatKickoff(match.kickoff_at)}</p>

      {locked ? (
        <LockedSummary match={match} existing={existing} />
      ) : (
        <form onSubmit={handleSave} className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            value={home}
            onChange={(e) => {
              setHome(e.target.value);
              setStatus("idle");
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
              setAway(e.target.value);
              setStatus("idle");
            }}
            placeholder="–"
            aria-label={`Predicted score for ${team2}`}
            className="w-14 rounded-lg border border-neutral-300 px-2 py-1.5 text-center font-mono text-sm focus:border-pitch focus:outline-none"
          />
          <button
            type="submit"
            disabled={status === "saving" || home === "" || away === ""}
            className="ml-auto rounded-lg bg-pitch px-3 py-1.5 text-xs font-semibold text-gold transition hover:opacity-90 disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : existing ? "Update" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Read-only view shown once a match has kicked off — picks can no longer change. */
function LockedSummary({ match, existing }: { match: Match; existing: MatchPrediction | null }) {
  const hasResult = match.home_score !== null && match.away_score !== null;

  if (!existing) {
    return (
      <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
        You didn&rsquo;t lock in a pick before kickoff — no points possible for this match.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-xs">
      <span className="text-neutral-600">
        Your pick:{" "}
        <span className="font-mono font-semibold text-neutral-900">
          {existing.predicted_home}–{existing.predicted_away}
        </span>
        {hasResult && (
          <>
            {" "}
            · Final:{" "}
            <span className="font-mono font-semibold text-neutral-900">
              {match.home_score}–{match.away_score}
            </span>
          </>
        )}
      </span>
      {existing.points_awarded !== null && (
        <span className="badge bg-gold/20 text-pitch">+{existing.points_awarded} pts</span>
      )}
    </div>
  );
}
