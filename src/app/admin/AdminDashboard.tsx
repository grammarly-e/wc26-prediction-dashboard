"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUND_ORDER, groupByRound, isKnockoutRound } from "@/lib/match-utils";
import type { Match, MatchStatus, Team, WinnerSide } from "@/lib/types";

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

export interface AwardWinner {
  category_key: string;
  winner_name: string;
  declared_at: string;
}

const ALL_AWARD_CATEGORIES: Array<{ key: string; label: string; hasParticipantPicks: boolean }> = [
  { key: "golden_boot",       label: "Golden Boot",       hasParticipantPicks: true },
  { key: "silver_boot",       label: "Silver Boot",       hasParticipantPicks: false },
  { key: "bronze_boot",       label: "Bronze Boot",       hasParticipantPicks: false },
  { key: "golden_ball",       label: "Golden Ball",       hasParticipantPicks: true },
  { key: "silver_ball",       label: "Silver Ball",       hasParticipantPicks: false },
  { key: "bronze_ball",       label: "Bronze Ball",       hasParticipantPicks: false },
  { key: "best_young_player", label: "Best Young Player", hasParticipantPicks: true },
];

interface EditState {
  homeScore: string;
  awayScore: string;
  status: MatchStatus;
  /** Knockout-only: who actually won (including penalties). Null = undecided. */
  winnerSide: WinnerSide | null;
  /** Once the admin manually picks a winner, stop auto-defaulting it from the scoreline. */
  winnerSideTouched: boolean;
}

/** Auto-default for the winner toggle: whichever side is ahead on the entered
 *  scoreline. Returns null on a tie or incomplete entry — knockout matches
 *  can't end level, so a tied 90-minutes-+-stoppage-time scoreline (decided
 *  in extra time or on penalties) always needs an explicit manual pick. */
function leadingSide(homeStr: string, awayStr: string): WinnerSide | null {
  if (homeStr === "" || awayStr === "") return null;
  const home = parseInt(homeStr, 10);
  const away = parseInt(awayStr, 10);
  if (Number.isNaN(home) || Number.isNaN(away)) return null;
  if (home > away) return "team1";
  if (away > home) return "team2";
  return null;
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
  teams,
  awardWinners: initialAwardWinners,
}: {
  matches: Match[];
  participants: ParticipantRow[];
  teams: Team[];
  awardWinners: AwardWinner[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<"matches" | "participants" | "awards">("matches");

  // Award winners state
  const [awardWinners, setAwardWinners] = useState<AwardWinner[]>(initialAwardWinners);
  const [awardInputs, setAwardInputs] = useState<Record<string, string>>(
    Object.fromEntries(ALL_AWARD_CATEGORIES.map((c) => [c.key, ""]))
  );
  const [savingAward, setSavingAward] = useState<string | null>(null);
  const [deletingAward, setDeletingAward] = useState<string | null>(null);

  // Match editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({
    homeScore: "",
    awayScore: "",
    status: "scheduled",
    winnerSide: null,
    winnerSideTouched: false,
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

  // Combined sync state
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  // Stale-live recovery state
  const [recovering, setRecovering] = useState(false);
  const [recoverResult, setRecoverResult] = useState<string | null>(null);

  // Participant state
  const [participants, setParticipants] = useState(initialParticipants);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Knockout team-slot override state (see migration 0013 + override-match-teams route)
  const [overrideMatchId, setOverrideMatchId] = useState<string | null>(null);
  const [overrideState, setOverrideState] = useState<{ team1Id: string; team2Id: string }>({
    team1Id: "",
    team2Id: "",
  });
  const [savingOverride, setSavingOverride] = useState(false);

  // Build round -> match map
  const grouped = groupByRound(matches);

  function startEdit(match: Match) {
    setEditingId(match.id);
    setEditState({
      homeScore: match.home_score != null ? String(match.home_score) : "",
      awayScore: match.away_score != null ? String(match.away_score) : "",
      status: match.status,
      winnerSide: match.winner_side,
      // An existing winner_side reflects a prior explicit decision (manual
      // pick or provider sync) — treat it as already-touched so editing the
      // score doesn't silently flip it via the auto-default.
      winnerSideTouched: match.winner_side != null,
    });
  }

  async function saveMatch(match: Match) {
    if (
      isKnockoutRound(match.round) &&
      editState.homeScore !== "" &&
      editState.awayScore !== "" &&
      !editState.winnerSide
    ) {
      alert("Select who won before saving — required for knockout matches (a draw isn't a valid final outcome).");
      return;
    }
    if (isKnockoutRound(match.round) && editState.winnerSide) {
      const decisive = leadingSide(editState.homeScore, editState.awayScore);
      if (decisive && decisive !== editState.winnerSide) {
        const pickedCode = editState.winnerSide === "team1" ? match.team1_code : match.team2_code;
        alert(
          `Winner pick (${pickedCode}) doesn't match the scoreline (${editState.homeScore}-${editState.awayScore}). ` +
          `Fix one before saving — this sets the official result used to score every participant.`
        );
        return;
      }
    }
    // A "Scheduled"/"Postponed"/"Cancelled" match can never legitimately have
    // both scores filled in -- that combination has previously caused
    // matches to score correctly on a participant's own page while being
    // silently excluded from the leaderboard, which strictly requires status
    // === "finished". Catch the likely oversight (score entered, Status
    // dropdown left unchanged) before it reaches the server. "Live" is left
    // out of this check on purpose -- a provisional in-progress score there
    // is a legitimate, intentional state.
    if (
      editState.homeScore !== "" &&
      editState.awayScore !== "" &&
      editState.status !== "finished" &&
      editState.status !== "live"
    ) {
      alert(
        `Status is still "${editState.status}" but both scores are filled in. ` +
        `Set Status to "Finished" (or "Live" if this is a provisional in-progress score) before saving — ` +
        `otherwise this match will score correctly on participants' own pages but be dropped from the leaderboard.`
      );
      return;
    }
    setSaving(true);
    const res = await fetch("/api/admin/update-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: match.id,
        homeScore: editState.homeScore !== "" ? parseInt(editState.homeScore, 10) : null,
        awayScore: editState.awayScore !== "" ? parseInt(editState.awayScore, 10) : null,
        status: editState.status,
        round: match.round,
        winnerSide: editState.winnerSide,
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

  function toggleOverridePanel(match: Match) {
    if (overrideMatchId === match.id) {
      setOverrideMatchId(null);
      return;
    }
    setOverrideMatchId(match.id);
    setOverrideState({
      team1Id: match.team1_id ?? "",
      team2Id: match.team2_id ?? "",
    });
  }

  async function saveOverride(match: Match) {
    setSavingOverride(true);
    const res = await fetch("/api/admin/override-match-teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: match.id,
        team1Id: overrideState.team1Id || null,
        team2Id: overrideState.team2Id || null,
        team1Locked: true,
        team2Locked: true,
      }),
    });
    setSavingOverride(false);
    if (res.ok) {
      const body = await res.json() as { recomputeError?: string };
      if (body.recomputeError) {
        alert("Override saved but recompute failed:\n" + body.recomputeError);
      }
      setOverrideMatchId(null);
      startTransition(() => router.refresh());
    } else {
      const body = await res.json() as { error?: string };
      alert("Error: " + (body.error ?? "unknown"));
    }
  }

  async function clearOverride(match: Match) {
    setSavingOverride(true);
    const res = await fetch("/api/admin/override-match-teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: match.id,
        team1Id: match.team1_id,
        team2Id: match.team2_id,
        team1Locked: false,
        team2Locked: false,
      }),
    });
    setSavingOverride(false);
    if (res.ok) {
      setOverrideMatchId(null);
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

  async function runAll() {
    setRunning(true);
    setRunResult(null);
    const parts: string[] = [];

    // 1. Sync & Score
    try {
      const res = await fetch("/api/admin/sync", { method: "POST" });
      const body = await res.json() as { finishedScored?: number; error?: string };
      parts.push(res.ok
        ? `Sync: ${body.finishedScored ?? 0} match(es) scored`
        : `Sync error: ${body.error ?? "unknown"}`);
    } catch (e) {
      parts.push(`Sync error: ${(e as Error).message}`);
    }

    // 2. Recompute Standings & Bracket
    try {
      const res = await fetch("/api/admin/recompute", { method: "POST" });
      const body = await res.json() as {
        groupsRecomputed?: number;
        slotsUpdated?: number;
        statusPatched?: number;
        error?: string;
      };
      parts.push(res.ok
        ? `Standings: ${body.groupsRecomputed ?? 0} groups, ${body.slotsUpdated ?? 0} slots` +
          (body.statusPatched ? `, ${body.statusPatched} match(es) un-stuck from leaderboard` : "")
        : `Standings error: ${body.error ?? "unknown"}`);
    } catch (e) {
      parts.push(`Standings error: ${(e as Error).message}`);
    }

    // 3. Debug Scorers
    try {
      const res = await fetch("/api/admin/debug-scorers");
      const body = await res.json() as Record<string, unknown>;
      const scorerLines = [
        `events: ${body.goal_events_count ?? 0}`,
        `scorers: ${body.top_scorers_count ?? 0}`,
        `write test: ${body.test_insert_ok ? "OK" : `FAIL — ${body.test_insert_error}`}`,
      ];
      if (body.goal_events_error) scorerLines.push(`events ERR: ${body.goal_events_error}`);
      if (body.top_scorers_error) scorerLines.push(`scorers ERR: ${body.top_scorers_error}`);
      parts.push(`Scorers — ${scorerLines.join(", ")}`);
    } catch (e) {
      parts.push(`Scorers error: ${(e as Error).message}`);
    }

    setRunning(false);
    setRunResult(parts.join(" · "));
    startTransition(() => router.refresh());
  }

  async function recoverLive() {
    setRecovering(true);
    setRecoverResult(null);
    try {
      const res = await fetch("/api/admin/recover-live", { method: "POST" });
      const body = await res.json() as {
        ok?: boolean;
        staleFound?: number;
        results?: Array<{ matchNumber: number; outcome: string }>;
        error?: string;
      };
      if (res.ok) {
        if (!body.staleFound) {
          setRecoverResult("No stuck live matches found.");
        } else {
          const lines = (body.results ?? []).map((r) => `#${r.matchNumber}: ${r.outcome}`).join(" · ");
          setRecoverResult(`Found ${body.staleFound} stale match(es). ${lines}`);
          startTransition(() => router.refresh());
        }
      } else {
        setRecoverResult(`Error: ${body.error ?? "unknown"}`);
      }
    } catch (e) {
      setRecoverResult(`Error: ${(e as Error).message}`);
    } finally {
      setRecovering(false);
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

  async function saveAward(categoryKey: string) {
    const name = awardInputs[categoryKey]?.trim();
    if (!name) return;
    setSavingAward(categoryKey);
    const res = await fetch("/api/admin/award-winner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryKey, winnerName: name }),
    });
    setSavingAward(null);
    if (res.ok) {
      setAwardWinners((prev) => {
        const next = prev.filter((w) => w.category_key !== categoryKey);
        next.push({ category_key: categoryKey, winner_name: name, declared_at: new Date().toISOString() });
        return next;
      });
      setAwardInputs((prev) => ({ ...prev, [categoryKey]: "" }));
    } else {
      const body = await res.json() as { error?: string };
      alert("Error: " + (body.error ?? "unknown"));
    }
  }

  async function clearAward(categoryKey: string) {
    if (!confirm("Remove the declared winner for this award?")) return;
    setDeletingAward(categoryKey);
    const res = await fetch("/api/admin/award-winner", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryKey }),
    });
    setDeletingAward(null);
    if (res.ok) {
      setAwardWinners((prev) => prev.filter((w) => w.category_key !== categoryKey));
    } else {
      const body = await res.json() as { error?: string };
      alert("Error: " + (body.error ?? "unknown"));
    }
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
          {recoverResult && (
            <span className="max-w-lg break-words text-xs text-amber-700">{recoverResult}</span>
          )}
          {runResult && (
            <span className="max-w-lg break-words text-xs text-neutral-500">{runResult}</span>
          )}
          <button
            onClick={recoverLive}
            disabled={recovering}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            title="Force-finish matches stuck as &apos;live&apos; for more than 3.5 hours"
          >
            {recovering ? "Recovering..." : "Recover Stuck Matches"}
          </button>
          <button
            onClick={runAll}
            disabled={running}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {running ? "Running..." : "Sync & Update"}
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
        {(["matches", "participants", "awards"] as const).map((tab) => (
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
            {tab !== "awards" && (
              <span className="font-normal text-neutral-400">
                ({tab === "matches" ? matches.length : participants.length})
              </span>
            )}
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
                            {isKnockoutRound(m.round) && m.winner_side && (
                              <span className="ml-1 font-sans text-xs font-normal text-neutral-400">
                                ({m.winner_side === "team1" ? m.team1_code : m.team2_code} won)
                              </span>
                            )}
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

                        {/* Team-slot override toggle (knockout only) */}
                        {isKnockoutRound(m.round) && (
                          <button
                            onClick={() => toggleOverridePanel(m)}
                            className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                              overrideMatchId === m.id
                                ? "bg-pitch text-gold"
                                : m.team1_locked || m.team2_locked
                                ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                                : "text-neutral-500 hover:bg-neutral-100"
                            }`}
                            title="Manually override which teams occupy this knockout slot"
                          >
                            {m.team1_locked || m.team2_locked ? "🔒 Teams" : "Teams"}
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
                              onChange={(e) => {
                                const homeScore = e.target.value;
                                setEditState((s) => ({
                                  ...s,
                                  homeScore,
                                  winnerSide: s.winnerSideTouched ? s.winnerSide : leadingSide(homeScore, s.awayScore),
                                }));
                              }}
                              placeholder="H"
                              className="w-12 rounded border border-neutral-200 px-2 py-1 text-center font-mono text-sm"
                            />
                            <span className="text-neutral-400">-</span>
                            <input
                              type="number"
                              min={0}
                              max={99}
                              value={editState.awayScore}
                              onChange={(e) => {
                                const awayScore = e.target.value;
                                setEditState((s) => ({
                                  ...s,
                                  awayScore,
                                  winnerSide: s.winnerSideTouched ? s.winnerSide : leadingSide(s.homeScore, awayScore),
                                }));
                              }}
                              placeholder="A"
                              className="w-12 rounded border border-neutral-200 px-2 py-1 text-center font-mono text-sm"
                            />
                            {isKnockoutRound(m.round) && (
                              <div className="flex items-center gap-1" title="Who actually won (penalties count) — required for knockout matches">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditState((s) => ({ ...s, winnerSide: "team1", winnerSideTouched: true }))
                                  }
                                  className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
                                    editState.winnerSide === "team1"
                                      ? "bg-pitch text-gold"
                                      : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                                  }`}
                                >
                                  {m.team1_code} W
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditState((s) => ({ ...s, winnerSide: "team2", winnerSideTouched: true }))
                                  }
                                  className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
                                    editState.winnerSide === "team2"
                                      ? "bg-pitch text-gold"
                                      : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                                  }`}
                                >
                                  {m.team2_code} W
                                </button>
                              </div>
                            )}
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
                              onClick={() => saveMatch(m)}
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

                      {/* Team-slot override panel */}
                      {overrideMatchId === m.id && (
                        <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3">
                          <p className="mb-2 text-xs text-neutral-500">
                            Manually set the teams in this slot. Locking a side stops the
                            automatic hourly resolver from overwriting it.
                          </p>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-1.5">
                              <select
                                value={overrideState.team1Id}
                                onChange={(e) =>
                                  setOverrideState((s) => ({ ...s, team1Id: e.target.value }))
                                }
                                className="rounded border border-neutral-200 px-2 py-1 text-xs"
                              >
                                <option value="">— unresolved ({m.team1_code}) —</option>
                                {teams.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                              {m.team1_locked && (
                                <span
                                  className="text-xs text-amber-600"
                                  title="Locked: auto-resolver won't touch this side"
                                >
                                  🔒
                                </span>
                              )}
                            </div>
                            <span className="text-neutral-400">vs</span>
                            <div className="flex items-center gap-1.5">
                              <select
                                value={overrideState.team2Id}
                                onChange={(e) =>
                                  setOverrideState((s) => ({ ...s, team2Id: e.target.value }))
                                }
                                className="rounded border border-neutral-200 px-2 py-1 text-xs"
                              >
                                <option value="">— unresolved ({m.team2_code}) —</option>
                                {teams.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                              {m.team2_locked && (
                                <span
                                  className="text-xs text-amber-600"
                                  title="Locked: auto-resolver won't touch this side"
                                >
                                  🔒
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => saveOverride(m)}
                              disabled={savingOverride}
                              className="rounded bg-pitch px-3 py-1 text-xs font-semibold text-gold disabled:opacity-50"
                            >
                              {savingOverride ? "..." : "Lock & Save"}
                            </button>
                            {(m.team1_locked || m.team2_locked) && (
                              <button
                                onClick={() => clearOverride(m)}
                                disabled={savingOverride}
                                className="rounded px-3 py-1 text-xs font-semibold text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
                              >
                                Unlock (resume auto)
                              </button>
                            )}
                          </div>
                        </div>
                      )}

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

      {/* Awards tab */}
      {activeTab === "awards" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-500">
            Declare the official winners for each award. These will be displayed on the leaderboard
            alongside participants&rsquo; predictions. No automatic scoring is triggered.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ALL_AWARD_CATEGORIES.map((cat) => {
              const current = awardWinners.find((w) => w.category_key === cat.key);
              return (
                <div key={cat.key} className="card flex flex-col gap-3 p-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      {cat.label}
                    </p>
                    {cat.hasParticipantPicks && (
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        Participants made picks for this award
                      </p>
                    )}
                  </div>

                  {/* Current declared winner */}
                  {current ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2">
                      <div>
                        <p className="text-xs text-emerald-600">Declared winner</p>
                        <p className="text-sm font-semibold text-emerald-800">{current.winner_name}</p>
                      </div>
                      <button
                        onClick={() => clearAward(cat.key)}
                        disabled={deletingAward === cat.key}
                        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
                      >
                        {deletingAward === cat.key ? "..." : "Clear"}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-400 italic">Not yet declared</p>
                  )}

                  {/* Input to set / update winner */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={current ? "Update winner..." : "Enter player name..."}
                      value={awardInputs[cat.key] ?? ""}
                      onChange={(e) =>
                        setAwardInputs((prev) => ({ ...prev, [cat.key]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveAward(cat.key);
                      }}
                      className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-pitch/30"
                    />
                    <button
                      onClick={() => void saveAward(cat.key)}
                      disabled={savingAward === cat.key || !awardInputs[cat.key]?.trim()}
                      className="rounded bg-pitch px-3 py-1.5 text-xs font-semibold text-gold disabled:opacity-50"
                    >
                      {savingAward === cat.key ? "..." : "Save"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
