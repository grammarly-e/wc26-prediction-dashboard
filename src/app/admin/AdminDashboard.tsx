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

const EVENT_TYPE_OPTIONS: Array<{ value: "goal" | "own_goal" | "penalty_goal"; label: string }> = [
  { value: "goal", label: "Goal" },
  { value: "own_goal", label: "Own Goal" },
  { value: "penalty_goal", label: "Penalty" },
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

interface MatchEventRow {
  id: string;
  team_id: string | null;
  player_name: string | null;
  minute: number;
  event_type: string;
  detail: string | null;
}

interface AddEventState {
  playerName: string;
  teamSide: "home" | "away";
  minute: string;
  eventType: "goal" | "own_goal" | "penalty_goal";
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

  // Events panel state
  const [eventsMatchId, setEventsMatchId] = useState<string | null>(null);
  const [eventsCache, setEventsCache] = useState<Map<string, MatchEventRow[]>>(new Map());
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [addingEvent, setAddingEvent] = useState(false);
  const [addEventState, setAddEventState] = useState<AddEventState>({
    playerName: "",
    teamSide: "home",
    minute: "",
    eventType: "goal",
  });

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Recompute state
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<string | null>(null);

  // Participant state
  const [participants, setParticipants] = useState(initialParticipants);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Build round -> match map
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
      const body = await res.json() as { ok: boolean; recomputeError?: string };
      if (body.recomputeError) {
        alert("Match saved but standings recompute failed:\n" + body.recomputeError);
      }
      setEditingId(null);
      startTransition(() => router.refresh());
    } else {
      const body = await res.json() as { error?: string };
      alert("Error: " + (body.error ?? "unknown"));
    }
  }

  async function toggleEventsPanel(match: Match) {
    if (eventsMatchId === match.id) {
      setEventsMatchId(null);
      return;
    }
    setEventsMatchId(match.id);
    if (eventsCache.has(match.id)) return;
    setLoadingEvents(true);
    try {
      const res = await fetch(`/api/admin/match-events?matchId=${match.id}`);
      const body = await res.json() as { events?: MatchEventRow[]; error?: string };
      if (res.ok) {
        setEventsCache((prev) => new Map(prev).set(match.id, body.events ?? []));
      } else {
        alert("Failed to load events: " + (body.error ?? "unknown"));
        setEventsMatchId(null);
      }
    } finally {
      setLoadingEvents(false);
    }
  }

  async function addEvent(match: Match) {
    if (!addEventState.playerName.trim() || !addEventState.minute) return;
    const teamId = addEventState.teamSide === "home" ? match.team1_id : match.team2_id;
    setAddingEvent(true);
    const res = await fetch("/api/admin/match-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: match.id,
        teamId,
        playerName: addEventState.playerName.trim(),
        minute: parseInt(addEventState.minute, 10),
        eventType: addEventState.eventType,
        detail: null,
      }),
    });
    setAddingEvent(false);
    const body = await res.json() as { ok?: boolean; error?: string; rebuildWarning?: string };
    if (res.ok) {
      if (body.rebuildWarning) {
        alert("Event saved, but scorer rebuild failed:\n" + body.rebuildWarning);
      }
      setAddEventState({ playerName: "", teamSide: "home", minute: "", eventType: "goal" });
      // Refresh events for this match
      const refresh = await fetch(`/api/admin/match-events?matchId=${match.id}`);
      const refreshBody = await refresh.json() as { events?: MatchEventRow[] };
      if (refresh.ok) {
        setEventsCache((prev) => new Map(prev).set(match.id, refreshBody.events ?? []));
      }
      startTransition(() => router.refresh());
    } else {
      alert("Error: " + (body.error ?? "unknown"));
    }
  }

  async function deleteEvent(eventId: string, matchId: string) {
    setDeletingEventId(eventId);
    const res = await fetch("/api/admin/match-events", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId }),
    });
    setDeletingEventId(null);
    const body = await res.json() as { ok?: boolean; error?: string; rebuildWarning?: string };
    if (res.ok) {
      if (body.rebuildWarning) {
        alert("Event removed, but scorer rebuild failed:\n" + body.rebuildWarning);
      }
      setEventsCache((prev) => {
        const updated = new Map(prev);
        const list = updated.get(matchId) ?? [];
        updated.set(matchId, list.filter((e) => e.id !== eventId));
        return updated;
      });
      startTransition(() => router.refresh());
    } else {
      alert("Error deleting event: " + (body.error ?? "unknown"));
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/admin/sync", { method: "POST" });
    setSyncing(false);
    if (res.ok) {
      const body = await res.json() as { finishedScored?: number };
      setSyncResult(`Done - ${body.finishedScored ?? 0} match(es) scored.`);
      startTransition(() => router.refresh());
    } else {
      const body = await res.json() as { error?: string };
      setSyncResult("Error: " + (body.error ?? "unknown"));
    }
  }

  async function runRecompute() {
    setRecomputing(true);
    setRecomputeResult(null);
    const res = await fetch("/api/admin/recompute", { method: "POST" });
    setRecomputing(false);
    if (res.ok) {
      const body = await res.json() as { groupsRecomputed?: number; slotsUpdated?: number };
      setRecomputeResult(
        `Standings recomputed (${body.groupsRecomputed ?? 0} groups), ${body.slotsUpdated ?? 0} bracket slot(s) updated.`
      );
      startTransition(() => router.refresh());
    } else {
      const body = await res.json() as { error?: string };
      setRecomputeResult("Error: " + (body.error ?? "unknown"));
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

  function eventLabel(e: MatchEventRow): string {
    const icon = e.event_type === "own_goal" ? "OG" : e.event_type === "penalty_goal" ? "P" : "";
    return `${e.minute}'  ${e.player_name ?? "Unknown"}${icon ? " (" + icon + ")" : ""}`;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <div className="flex flex-wrap items-center gap-3">
          {recomputeResult && (
            <span className="text-xs text-neutral-500">{recomputeResult}</span>
          )}
          {syncResult && (
            <span className="text-xs text-neutral-500">{syncResult}</span>
          )}
          <button
            onClick={runRecompute}
            disabled={recomputing}
            className="rounded-lg bg-pitch px-4 py-2 text-sm font-semibold text-gold hover:opacity-90 disabled:opacity-50"
          >
            {recomputing ? "Recomputing..." : "Recompute Standings & Bracket"}
          </button>
          <button
            onClick={runSync}
            disabled={syncing}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync & Score"}
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
                    <div key={m.id} className="card overflow-hidden">
                      {/* Match row */}
                      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
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
                            {m.home_score}-{m.away_score}
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

                        {/* Events toggle (only when score known) */}
                        {m.home_score != null && (
                          <button
                            onClick={() => toggleEventsPanel(m)}
                            className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                              eventsMatchId === m.id
                                ? "bg-pitch text-gold"
                                : "text-neutral-500 hover:bg-neutral-100"
                            }`}
                          >
                            ⚽ Events
                          </button>
                        )}

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
                            <span className="text-neutral-400">-</span>
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
                              {saving ? "..." : "Save"}
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

                      {/* Events panel */}
                      {eventsMatchId === m.id && (
                        <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3">
                          {loadingEvents && !eventsCache.has(m.id) ? (
                            <p className="text-xs text-neutral-400">Loading events...</p>
                          ) : (
                            <>
                              {/* Existing events list */}
                              <div className="mb-3 flex flex-col gap-1">
                                {(eventsCache.get(m.id) ?? []).length === 0 ? (
                                  <p className="text-xs text-neutral-400">No events recorded yet.</p>
                                ) : (
                                  (eventsCache.get(m.id) ?? []).map((e) => (
                                    <div key={e.id} className="flex items-center justify-between gap-2">
                                      <span className="text-xs text-neutral-700">
                                        ⚽ {eventLabel(e)}
                                      </span>
                                      <button
                                        onClick={() => deleteEvent(e.id, m.id)}
                                        disabled={deletingEventId === e.id}
                                        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
                                      >
                                        {deletingEventId === e.id ? "..." : "Remove"}
                                      </button>
                                    </div>
                                  ))
                                )}
                              </div>

                              {/* Add event form */}
                              <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3">
                                <input
                                  type="text"
                                  placeholder="Player name"
                                  value={addEventState.playerName}
                                  onChange={(e) =>
                                    setAddEventState((s) => ({ ...s, playerName: e.target.value }))
                                  }
                                  className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 text-xs"
                                />
                                <select
                                  value={addEventState.teamSide}
                                  onChange={(e) =>
                                    setAddEventState((s) => ({
                                      ...s,
                                      teamSide: e.target.value as "home" | "away",
                                    }))
                                  }
                                  className="rounded border border-neutral-200 px-2 py-1 text-xs"
                                >
                                  <option value="home">Home ({m.team1_code})</option>
                                  <option value="away">Away ({m.team2_code})</option>
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  max={120}
                                  placeholder="Min"
                                  value={addEventState.minute}
                                  onChange={(e) =>
                                    setAddEventState((s) => ({ ...s, minute: e.target.value }))
                                  }
                                  className="w-16 rounded border border-neutral-200 px-2 py-1 text-center text-xs"
                                />
                                <select
                                  value={addEventState.eventType}
                                  onChange={(e) =>
                                    setAddEventState((s) => ({
                                      ...s,
                                      eventType: e.target.value as "goal" | "own_goal" | "penalty_goal",
                                    }))
                                  }
                                  className="rounded border border-neutral-200 px-2 py-1 text-xs"
                                >
                                  {EVENT_TYPE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => addEvent(m)}
                                  disabled={
                                    addingEvent ||
                                    !addEventState.playerName.trim() ||
                                    !addEventState.minute
                                  }
                                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {addingEvent ? "..." : "Add"}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
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
                  Joined {new Date(p.created_at).toLocaleDateString()} &middot;{" "}
                  {p.match_prediction_count} match picks
                </p>
              </div>
              <button
                onClick={() => deleteParticipant(p.id, p.display_name)}
                disabled={deletingId === p.id}
                className="rounded px-3 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50"
              >
                {deletingId === p.id ? "..." : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
