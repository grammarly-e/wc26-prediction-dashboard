"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Match, MatchStatus } from "@/lib/types";

const ROUND_ORDER = [
  "Group Stage",
  "Round of 32",
  "Round of 16",
  "Quarter-final",
  "Semi-final",
  "Match for third place",
  "Final",
] as const;

const STATUS_OPTIONS: MatchStatus[] = [
  "scheduled",
  "live",
  "finished",
  "postponed",
  "cancelled",
];

export interface ParticipantRow {
  id: string;
  display_name: string;
  created_at: string;
  match_prediction_count: number;
}

interface EditState {
  homeScore: string;
  awayScore: string;
  status: MatchStatus;
}

export default function AdminDashboard({
  matches,
  participants: initialParticipants,
}: {
  matches: Match[];
  participants: ParticipantRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<"matches" | "participants">("matches");

  // Match editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    homeScore: "",
    awayScore: "",
    status: "scheduled",
  });
  const [saving, setSaving] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Participant state
  const [participants, setParticipants] = useState(initialParticipants);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Build round → match map
  const grouped = new Map<string, Match[]>();
  for (const round of ROUND_ORDER) grouped.set(round, []);
  for (const m of matches) {
    const list = grouped.get(m.round) ?? [];
    list.push(m);
    grouped.set(m.round, list);
  }

  function startEdit(match: Match) {
    setEditingId(match.id);
    setEditState({
      homeScore: match.home_score != null ? String(match.home_score) : "",
      awayScore: match.away_score != null ? String(match.away_score) : "",
      status: match.status,
    });
  }

  async function saveMatch(matchId: string) {
    setSaving(true);
    const res = await fetch("/api/admin/update-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId,
        homeScore: editState.homeScore !== "" ? parseInt(editState.homeScore, 10) : null,
        awayScore: editState.awayScore !== "" ? parseInt(editState.awayScore, 10) : null,
        status: editState.status,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setEditingId(null);
      startTransition(() => router.refresh());
    } else {
      const body = await res.json() as { error?: string };
      alert("Error: " + (body.error ?? "unknown"));
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/admin/sync", { method: "POST" });
    setSyncing(false);
    if (res.ok) {
      const body = await res.json() as { finishedScored?: number };
      setSyncResult(`Done — ${body.finishedScored ?? 0} match(es) scored.`);
      startTransition(() => router.refresh());
    } else {
      const body = await res.json() as { error?: string };
      setSyncResult("Error: " + (body.error ?? "unknown"));
    }
  }

  async function deleteParticipant(id: string, name: string) {
    if (!confirm(`Delete "${name}" and all their predictions? This cannot be undone.`)) return;
    setDeletingId(id);
    const res = await fetch("/api/admin/delete-participant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: id }),
    });
    setDeletingId(null);
    if (res.ok) {
      setParticipants((prev) => prev.filter((p) => p.id !== id));
    } else {
      const body = await res.json() as { error?: string };
      alert("Error: " + (body.error ?? "unknown"));
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <div className="flex flex-wrap items-center gap-3">
          {syncResult && (
            <span className="text-xs text-neutral-500">{syncResult}</span>
          )}
          <button
            onClick={runSync}
            disabled={syncing}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync & Score"}
          </button>
          <button
            onClick={logout}
            className="text-xs text-neutral-400 hover:text-neutral-600"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-neutral-200">
        {(["matches", "participants"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 text-sm font-semibold capitalize transition-colors ${
              activeTab === tab
                ? "border-b-2 border-pitch text-pitch"
                : "text-neutral-400 hover:text-neutral-600"
            }`}
          >
            {tab}{" "}
            <span className="font-normal text-neutral-400">
              ({tab === "matches" ? matches.length : participants.length})
            </span>
          </button>
        ))}
      </div>

      {/* Matches tab */}
      {activeTab === "matches" && (
        <div className="flex flex-col gap-6">
          {ROUND_ORDER.map((round) => {
            const roundMatches = grouped.get(round) ?? [];
            if (roundMatches.length === 0) return null;
            return (
              <section key={round}>
                <h2 className="mb-2 font-semibold text-neutral-700">
                  {round}{" "}
                  <span className="font-normal text-neutral-400">
                    ({roundMatches.length})
                  </span>
                </h2>
                <div className="flex flex-col gap-1.5">
                  {roundMatches.map((m) => (
                    <div
                      key={m.id}
                      className="card flex flex-wrap items-center gap-3 px-3 py-2.5"
                    >
                      {/* Match identity */}
                      <span className="w-7 shrink-0 text-xs text-neutral-400">
                        #{m.match_number}
                      </span>
                      <span className="flex-1 truncate text-sm font-medium">
                        {m.team1_code} vs {m.team2_code}
                      </span>

                      {/* Current result */}
                      {m.status === "finished" && m.home_score != null ? (
                        <span className="font-mono text-sm font-bold text-pitch">
                          {m.home_score}–{m.away_score}
                        </span>
                      ) : null}

                      <span
                        className={`badge text-xs ${
                          m.status === "finished"
                            ? "bg-neutral-100 text-neutral-500"
                            : m.status === "live"
                            ? "bg-red-100 text-red-700"
                            : m.status === "scheduled"
                            ? "bg-sky-50 text-sky-700"
                            : "bg-yellow-50 text-yellow-700"
                        }`}
                      >
                        {m.status}
                      </span>

                      {/* Edit form or button */}
                      {editingId === m.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={99}
                            value={editState.homeScore}
                            onChange={(e) =>
                              setEditState((s) => ({ ...s, homeScore: e.target.value }))
                            }
                            placeholder="H"
                            className="w-12 rounded border border-neutral-200 px-2 py-1 text-center font-mono text-sm"
                          />
                          <span className="text-neutral-400">–</span>
                          <input
                            type="number"
                            min={0}
                            max={99}
                            value={editState.awayScore}
                            onChange={(e) =>
                              setEditState((s) => ({ ...s, awayScore: e.target.value }))
                            }
                            placeholder="A"
                            className="w-12 rounded border border-neutral-200 px-2 py-1 text-center font-mono text-sm"
                          />
                          <select
                            value={editState.status}
                            onChange={(e) =>
                              setEditState((s) => ({
                                ...s,
                                status: e.target.value as MatchStatus,
                              }))
                            }
                            className="rounded border border-neutral-200 px-2 py-1 text-xs"
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => saveMatch(m.id)}
                            disabled={saving}
                            className="rounded bg-pitch px-3 py-1 text-xs font-semibold text-gold disabled:opacity-50"
                          >
                            {saving ? "…" : "Save"}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-xs text-neutral-400 hover:text-neutral-600"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(m)}
                          className="rounded px-3 py-1 text-xs font-semibold text-neutral-500 hover:bg-neutral-100"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Participants tab */}
      {activeTab === "participants" && (
        <div className="flex flex-col gap-1.5">
          {participants.length === 0 && (
            <p className="text-sm text-neutral-500">No participants yet.</p>
          )}
          {participants.map((p) => (
            <div key={p.id} className="card flex items-center gap-4 px-3 py-2.5">
              <div className="flex-1">
                <p className="text-sm font-medium">{p.display_name}</p>
                <p className="text-xs text-neutral-400">
                  Joined {new Date(p.created_at).toLocaleDateString()} ·{" "}
                  {p.match_prediction_count} match picks
                </p>
              </div>
              <button
                onClick={() => deleteParticipant(p.id, p.display_name)}
                disabled={deletingId === p.id}
                className="rounded px-3 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50"
              >
                {deletingId === p.id ? "…" : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
