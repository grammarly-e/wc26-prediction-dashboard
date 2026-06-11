"use client";

// ============================================================================
// FavouritesPickSection -- client component that manages all 3 favourite
// team picks together so combined-odds validation can work across cards.
//
// The 25% cap: the sum of win-probability odds for the 3 chosen teams must
// not exceed FAVOURITES_ODDS_CAP (25%). Each card's save button is blocked
// until the combined total is within the cap.
// ============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FAVOURITES_ODDS_CAP } from "@/lib/odds";
import type { PredictionCategory, Team } from "@/lib/types";

const SLOT_LABELS: Record<string, string> = {
  champion: "Favourite Team #1",
  runner_up: "Favourite Team #2",
  third_place: "Favourite Team #3",
};

function formatLockTime(iso: string): string {
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
  /** The 3 favourite categories (champion / runner_up / third_place), in display order. */
  categories: PredictionCategory[];
  /** All non-placeholder teams, alphabetical. */
  teams: Team[];
  /** team_id -> display name */
  teamNames: Record<string, string>;
  /** category_key -> currently saved predicted_team_id */
  existingTeamIds: Record<string, string>;
  participantId: string;
  /** team_id -> win probability (%) */
  teamIdOdds: Record<string, number>;
}

export default function FavouritesPickSection({
  categories,
  teams,
  teamNames,
  existingTeamIds,
  participantId,
  teamIdOdds,
}: Props) {
  const router = useRouter();

  // Local selections: initialized from saved picks, updated on user input.
  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const cat of categories) {
      init[cat.key] = existingTeamIds[cat.key] ?? "";
    }
    return init;
  });

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  // Compute combined odds across all 3 selections.
  const combined = Object.values(selections).reduce(
    (sum, tid) => sum + (tid ? (teamIdOdds[tid] ?? 0) : 0),
    0
  );
  const overCap = combined > FAVOURITES_ODDS_CAP;
  const remaining = FAVOURITES_ODDS_CAP - combined;

  async function handleSave(categoryKey: string) {
    const teamId = selections[categoryKey];
    if (!teamId) {
      setErrors((e) => ({ ...e, [categoryKey]: "Pick a team first." }));
      return;
    }
    if (overCap) {
      setErrors((e) => ({
        ...e,
        [categoryKey]: `Combined odds are ${combined.toFixed(2)}% -- must be ${FAVOURITES_ODDS_CAP}% or under. Pick a less-favoured team.`,
      }));
      return;
    }

    setSavingKey(categoryKey);
    setErrors((e) => ({ ...e, [categoryKey]: "" }));

    const supabase = createClient();
    const { error } = await supabase.from("tournament_predictions").upsert(
      {
        participant_id: participantId,
        category_key: categoryKey,
        predicted_team_id: teamId,
        predicted_player_id: null,
        predicted_player_name: null,
      },
      { onConflict: "participant_id,category_key" }
    );

    setSavingKey(null);
    if (error) {
      setErrors((e) => ({
        ...e,
        [categoryKey]:
          error.code === "42501"
            ? "This category has locked -- picks can no longer change."
            : "Could not save. Try again.",
      }));
    } else {
      setSavedKeys((s) => new Set([...s, categoryKey]));
      router.refresh();
    }
  }

  const sortedCats = [...categories].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)
  );

  // Are all 3 slots locked?
  const allLocked = sortedCats.every(
    (cat) => new Date(cat.locks_at).getTime() <= Date.now()
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Combined odds counter */}
      {!allLocked && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            overCap
              ? "border-red-300 bg-red-50"
              : "border-neutral-200 bg-neutral-50"
          }`}
        >
          <p className="font-semibold text-neutral-800">
            Combined odds cap:{" "}
            <span className="font-bold">{FAVOURITES_ODDS_CAP}% max</span>
          </p>
          <p
            className={`mt-0.5 text-xs ${
              overCap ? "text-red-600 font-semibold" : "text-neutral-500"
            }`}
          >
            Your 3 picks currently total{" "}
            <span className="font-mono font-semibold">
              {combined.toFixed(2)}%
            </span>
            {overCap
              ? ` -- ${Math.abs(remaining).toFixed(2)}% over the cap. Choose less-favoured teams to save.`
              : ` -- ${remaining.toFixed(2)}% remaining.`}
          </p>
        </div>
      )}

      {/* Pick cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedCats.map((category) => {
          const locked = new Date(category.locks_at).getTime() <= Date.now();
          const countdown = locked ? null : formatCountdown(category.locks_at);
          const selectedTeamId = selections[category.key] ?? "";
          const selectedOdds = selectedTeamId ? (teamIdOdds[selectedTeamId] ?? 0) : 0;
          const isSaving = savingKey === category.key;
          const isSaved = savedKeys.has(category.key);
          const errMsg = errors[category.key] ?? "";
          const savedTeamId = existingTeamIds[category.key] ?? "";

          return (
            <div key={category.key} className="card flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">
                    {SLOT_LABELS[category.key] ?? category.label}
                  </h3>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                    <span>locks {formatLockTime(category.locks_at)}</span>
                    {countdown && (
                      <span className="badge bg-pitch/10 text-pitch">
                        {countdown}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {locked ? (
                <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                  {savedTeamId ? (
                    <>
                      Your pick:{" "}
                      <span className="font-semibold text-neutral-900">
                        {teamNames[savedTeamId] ?? "Unknown team"}
                      </span>
                      {(teamIdOdds[savedTeamId] ?? 0) > 0 && (
                        <span className="ml-1 text-neutral-400">
                          ({teamIdOdds[savedTeamId]}%)
                        </span>
                      )}
                    </>
                  ) : (
                    "You didn't lock in a pick before this closed."
                  )}
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedTeamId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelections((s) => ({ ...s, [category.key]: val }));
                        setErrors((err) => ({ ...err, [category.key]: "" }));
                        setSavedKeys((s) => {
                          const next = new Set(s);
                          next.delete(category.key);
                          return next;
                        });
                      }}
                      className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-pitch focus:outline-none"
                    >
                      <option value="">Choose a team...</option>
                      {teams.map((t) => {
                        const odds = teamIdOdds[t.id] ?? 0;
                        return (
                          <option key={t.id} value={t.id}>
                            {t.flag_emoji ? `${t.flag_emoji} ` : ""}
                            {t.name}
                            {odds > 0 ? ` (${odds}%)` : ""}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      onClick={() => handleSave(category.key)}
                      disabled={isSaving || !selectedTeamId || overCap}
                      className="shrink-0 rounded-lg bg-pitch px-3 py-1.5 text-xs font-semibold text-gold transition hover:opacity-90 disabled:opacity-50"
                    >
                      {isSaving
                        ? "Saving..."
                        : isSaved
                        ? "Saved ✓"
                        : savedTeamId
                        ? "Update"
                        : "Save"}
                    </button>
                  </div>
                  {selectedTeamId && (
                    <p className="text-xs text-neutral-400">
                      This pick:{" "}
                      <span className="font-mono font-semibold">
                        {selectedOdds > 0 ? `${selectedOdds}%` : "unranked"}
                      </span>
                    </p>
                  )}
                </>
              )}
              {errMsg && <p className="text-xs text-red-600">{errMsg}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
