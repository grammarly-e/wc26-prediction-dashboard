"use client";

// ============================================================================
// One tournament-long award category (Champion, Golden Boot, Group Winner,
// etc.) with a single pick — team or player depending on `target_type`.
//
// Why a free-text name for player categories instead of a dropdown: the
// `players` table is populated opportunistically from football-data.org,
// which has a known gap in World Cup roster data on the free tier (see
// SETUP_AND_VERIFY.md). Forcing a dropdown would block predictions on data
// that may not exist yet. scoreTournamentPrediction() already falls back to
// a case-insensitive name comparison for exactly this reason — see
// src/lib/scoring.ts.
//
// Locking mirrors the database: once `locks_at` passes, RLS refuses writes
// and this flips to a read-only summary, same pattern as MatchPredictionCard.
// ============================================================================

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PredictionCategory, Team, TournamentPrediction } from "@/lib/types";

function formatLockTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Same relative-countdown treatment as MatchPredictionCard — these
 * categories lock at very different points across the tournament (some
 * before the opening match, some not until the semifinals), so "in 6 days"
 * vs. "in 11 weeks" is genuinely useful at-a-glance context. */
function formatCountdown(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `locks in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `locks in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `locks in ${days}d`;
  return `locks in ${Math.round(days / 7)}w`;
}

interface Props {
  category: PredictionCategory;
  teams: Team[];
  participantId: string;
  existing: TournamentPrediction | null;
  teamNames: Map<string, string>;
}

export default function CategoryPredictionCard({ category, teams, participantId, existing, teamNames }: Props) {
  const locked = new Date(category.locks_at).getTime() <= Date.now();
  const countdown = locked ? null : formatCountdown(category.locks_at);
  const isTeamPick = category.target_type === "team";

  // For group-winner categories, narrow the dropdown to that group's teams —
  // picking a team from Group B for "Group A Winner" can never score, so
  // there's no reason to offer it.
  const options = category.group_letter ? teams.filter((t) => t.group_letter === category.group_letter) : teams;

  const [teamId, setTeamId] = useState(existing?.predicted_team_id ?? "");
  const [playerName, setPlayerName] = useState(existing?.predicted_player_name ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const trimmedName = playerName.trim();
    if (isTeamPick && !teamId) {
      setError("Pick a team.");
      setStatus("error");
      return;
    }
    if (!isTeamPick && trimmedName.length < 2) {
      setError("Enter a player name (at least 2 characters).");
      setStatus("error");
      return;
    }

    setStatus("saving");
    setError(null);
    const supabase = createClient();

    // Explicitly typed to match the `tournament_predictions` row shape —
    // without this, TS infers a union of two object-literal shapes (one with
    // predicted_team_id: string, the other: null) that Supabase's generated
    // insert type (which wants a single shape with predicted_team_id: string | null)
    // refuses to accept. This was failing the production build.
    const payload: {
      participant_id: string;
      category_key: string;
      predicted_team_id: string | null;
      predicted_player_id: string | null;
      predicted_player_name: string | null;
    } = isTeamPick
      ? { participant_id: participantId, category_key: category.key, predicted_team_id: teamId, predicted_player_id: null, predicted_player_name: null }
      : { participant_id: participantId, category_key: category.key, predicted_team_id: null, predicted_player_id: null, predicted_player_name: trimmedName };

    const { error: upsertError } = await supabase
      .from("tournament_predictions")
      .upsert(payload, { onConflict: "participant_id,category_key" });

    if (upsertError) {
      setStatus("error");
      setError(
        upsertError.code === "42501"
          ? "This category has locked — picks can no longer change."
          : "Couldn't save your pick. Try again."
      );
      return;
    }

    setStatus("saved");
    router.refresh();
  }

  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{category.label}</h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
            <span>
              Worth {category.points_value} pts · locks {formatLockTime(category.locks_at)}
            </span>
            {countdown && <span className="badge bg-pitch/10 text-pitch">{countdown}</span>}
          </p>
        </div>
        {existing?.points_awarded !== null && existing?.points_awarded !== undefined && (
          <span
            className={`badge shrink-0 ${
              existing.points_awarded > 0 ? "bg-gold/30 text-pitch" : "bg-neutral-100 text-neutral-400"
            }`}
          >
            {existing.points_awarded > 0 ? `+${existing.points_awarded} pts` : "missed"}
          </span>
        )}
      </div>

      {locked ? (
        <LockedSummary category={category} existing={existing} teamNames={teamNames} />
      ) : (
        <form onSubmit={handleSave} className="flex items-center gap-2">
          {isTeamPick ? (
            <select
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setStatus("idle");
              }}
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-pitch focus:outline-none"
            >
              <option value="">Choose a team…</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.flag_emoji ? `${t.flag_emoji} ` : ""}
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={playerName}
              onChange={(e) => {
                setPlayerName(e.target.value);
                setStatus("idle");
              }}
              placeholder="Player name"
              maxLength={80}
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-pitch focus:outline-none"
            />
          )}
          <button
            type="submit"
            disabled={status === "saving"}
            className="shrink-0 rounded-lg bg-pitch px-3 py-1.5 text-xs font-semibold text-gold transition hover:opacity-90 disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : existing ? "Update" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function LockedSummary({
  category,
  existing,
  teamNames,
}: {
  category: PredictionCategory;
  existing: TournamentPrediction | null;
  teamNames: Map<string, string>;
}) {
  if (!existing) {
    return (
      <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
        You didn&rsquo;t lock in a pick before this category closed — no points possible here.
      </p>
    );
  }

  const pickLabel =
    category.target_type === "team"
      ? existing.predicted_team_id
        ? teamNames.get(existing.predicted_team_id) ?? "Unknown team"
        : "—"
      : existing.predicted_player_name ?? "—";

  return (
    <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
      Your pick: <span className="font-semibold text-neutral-900">{pickLabel}</span>
    </p>
  );
}
