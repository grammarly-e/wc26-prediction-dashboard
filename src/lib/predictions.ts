// ============================================================================
// Server-side data access for the prediction-submission and leaderboard pages.
//
// Counterpart to src/lib/data.ts (which handles the read-only live-tournament
// views). Everything here either reads/writes participant-owned rows — which
// RLS (supabase/migrations/0002_row_level_security.sql) restricts to "your
// own, before kickoff/lock" — or reads the public `leaderboard` view.
//
// Identity: participants sign in via Supabase anonymous auth (just a display
// name, no email/password — see JoinForm.tsx). `getCurrentParticipant()` is
// the single source of truth for "who is looking at this page right now,"
// and every page below should call it before deciding what to render.
// ============================================================================

import { createServerSupabaseClient, createServiceRoleClient } from "./supabase/server";
import { scoreMatchPrediction } from "./scoring";
import { correctOutcomeRate, isKnockoutRound } from "./match-utils";
import type {
  LeaderboardRow,
  Match,
  MatchPrediction,
  Participant,
  PredictionCategory,
  ScoreBreakdown,
  TournamentPrediction,
  WinnerSide,
} from "./types";

export async function getCurrentParticipant(): Promise<Participant | null> {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as Participant | null) ?? null;
}

export async function getPredictionCategories(): Promise<PredictionCategory[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("prediction_categories")
    .select("*")
    .order("display_order", { ascending: true });
  if (error) throw error;
  return data as PredictionCategory[];
}

export async function getMyMatchPredictions(participantId: string): Promise<Map<string, MatchPrediction>> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("match_predictions")
    .select("*")
    .eq("participant_id", participantId);
  if (error) throw error;
  const enriched = await enrichMatchPredictions(data as MatchPrediction[], supabase);
  return new Map(enriched.map((p) => [p.match_id, p]));
}

export async function getMyTournamentPredictions(
  participantId: string
): Promise<Map<string, TournamentPrediction>> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tournament_predictions")
    .select("*")
    .eq("participant_id", participantId);
  if (error) throw error;
  return new Map((data as TournamentPrediction[]).map((p) => [p.category_key, p]));
}

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("leaderboard")
    .select("*")
    .order("rank", { ascending: true });
  if (error) throw error;
  return data as LeaderboardRow[];
}

// ============================================================================
// Stage-split leaderboard
// ============================================================================

export interface StageLeaderboardRow {
  participant_id: string;
  display_name: string;
  group_stage_points: number;
  group_stage_matches_scored: number;
  group_stage_exact_hits: number;
  group_stage_correct_outcomes: number;
  knockout_points: number;
  knockout_matches_scored: number;
  knockout_exact_hits: number;
  knockout_correct_outcomes: number;
}

// ============================================================================
// Live-scoring enrichment helper
//
// Replaces stale/null points_awarded and score_breakdown on MatchPredictions
// with values computed directly from match scores — the same rules used by the
// leaderboard SQL view in migration 0010. Predictions for unfinished matches
// are returned unchanged (points_awarded remains null).
// ============================================================================

async function enrichMatchPredictions(
  predictions: MatchPrediction[],
  supabase: ReturnType<typeof createServerSupabaseClient>,
): Promise<MatchPrediction[]> {
  if (!predictions.length) return predictions;
  const matchIds = [...new Set(predictions.map((p) => p.match_id))];
  const { data: matchRows } = await supabase
    .from("matches")
    .select("id, round, home_score, away_score, winner_side")
    .eq("status", "finished")
    .in("id", matchIds);

  const finishedById = new Map(
    (
      (matchRows ?? []) as Array<{
        id: string;
        round: Match["round"];
        home_score: number | null;
        away_score: number | null;
        winner_side: WinnerSide | null;
      }>
    )
      .filter((m) => m.home_score !== null && m.away_score !== null)
      .map((m) => [m.id, m])
  );

  return predictions.map((p) => {
    const m = finishedById.get(p.match_id);
    if (!m) return p;
    const { points, breakdown } = scoreMatchPrediction({
      predictedHome: p.predicted_home,
      predictedAway: p.predicted_away,
      actualHome: m.home_score!,
      actualAway: m.away_score!,
      isKnockout: isKnockoutRound(m.round),
      predictedWinnerSide: p.predicted_winner_side,
      actualWinnerSide: m.winner_side,
    });
    return { ...p, points_awarded: points, score_breakdown: breakdown };
  });
}

export async function getStageLeaderboards(): Promise<{
  groupStage: StageLeaderboardRow[];
  knockout: StageLeaderboardRow[];
}> {
  // Service role, deliberately: this is the public, shared point total, not a
  // viewer-scoped read. createServerSupabaseClient() would apply RLS as the
  // current viewer's own session, and the "see others match predictions after
  // kickoff" policy (0002_row_level_security.sql) gates other participants'
  // rows on `kickoff_at <= now()` -- a field that is independent of, and can
  // drift out of sync with, `status`/score data. That mismatch silently
  // dropped specific participant+match combinations from the leaderboard
  // while those same rows scored correctly on the participant's own page
  // (getParticipantMatchPredictions() already uses the service role client
  // for exactly this reason). Bypassing RLS here makes the leaderboard match
  // the same trusted data path the individual page already uses.
  const supabase = createServiceRoleClient();
  // Compute points live from match scores — no dependency on points_awarded.
  // This mirrors the SQL scoring in leaderboard view migration 0010 so that
  // the stage breakdown updates the moment match scores land in the DB.
  const [predictionsRes, participantsRes] = await Promise.all([
    supabase
      .from("match_predictions")
      .select("participant_id, predicted_home, predicted_away, predicted_winner_side, matches!inner(round, status, home_score, away_score, winner_side)")
      .eq("matches.status", "finished")
      .not("predicted_home", "is", null)
      .not("predicted_away", "is", null),
    supabase.from("participants").select("id, display_name"),
  ]);
  if (predictionsRes.error) throw predictionsRes.error;
  if (participantsRes.error) throw participantsRes.error;

  const participantsList = participantsRes.data as Array<{ id: string; display_name: string }>;
  const nameById = new Map(participantsList.map((p) => [p.id, p.display_name]));

  const totals = new Map<string, StageLeaderboardRow>();
  function rowFor(participantId: string): StageLeaderboardRow {
    let row = totals.get(participantId);
    if (!row) {
      row = {
        participant_id: participantId,
        display_name: nameById.get(participantId) ?? "Unknown",
        group_stage_points: 0,
        group_stage_matches_scored: 0,
        group_stage_exact_hits: 0,
        group_stage_correct_outcomes: 0,
        knockout_points: 0,
        knockout_matches_scored: 0,
        knockout_exact_hits: 0,
        knockout_correct_outcomes: 0,
      };
      totals.set(participantId, row);
    }
    return row;
  }

  // Pre-seed every participant so both stage leaderboards are fully
  // populated from day one — the knockout table shows everyone at 0 points
  // rather than disappearing until the first knockout match finishes.
  for (const p of participantsList) rowFor(p.id);

  for (const pred of predictionsRes.data as unknown as Array<{
    participant_id: string;
    predicted_home: number;
    predicted_away: number;
    predicted_winner_side: WinnerSide | null;
    matches: {
      round: Match["round"];
      status: string;
      home_score: number | null;
      away_score: number | null;
      winner_side: WinnerSide | null;
    } | null;
  }>) {
    if (!pred.matches || pred.matches.home_score === null || pred.matches.away_score === null) continue;

    // Compute points using the same rules as scoring.ts / migration 0012
    const { points, breakdown } = scoreMatchPrediction({
      predictedHome: pred.predicted_home,
      predictedAway: pred.predicted_away,
      actualHome: pred.matches.home_score,
      actualAway: pred.matches.away_score,
      isKnockout: isKnockoutRound(pred.matches.round),
      predictedWinnerSide: pred.predicted_winner_side,
      actualWinnerSide: pred.matches.winner_side,
    });

    const row = rowFor(pred.participant_id);
    if (isKnockoutRound(pred.matches.round)) {
      row.knockout_points += points;
      row.knockout_matches_scored += 1;
      if (breakdown.exact_score) row.knockout_exact_hits += 1;
      if (breakdown.correct_outcome) row.knockout_correct_outcomes += 1;
    } else {
      row.group_stage_points += points;
      row.group_stage_matches_scored += 1;
      if (breakdown.exact_score) row.group_stage_exact_hits += 1;
      if (breakdown.correct_outcome) row.group_stage_correct_outcomes += 1;
    }
  }

  const all = Array.from(totals.values());
  // Tiebreak order: points, then W/D/L correct-outcome rate, then exact-score
  // hits, then name. W/D/L rate ranks above exact hits because consistently
  // calling the right result is a stronger signal than a handful of perfect
  // scorelines once total points are tied.
  return {
    groupStage: [...all].sort(
      (a, b) =>
        b.group_stage_points - a.group_stage_points ||
        correctOutcomeRate(b.group_stage_correct_outcomes, b.group_stage_matches_scored) -
          correctOutcomeRate(a.group_stage_correct_outcomes, a.group_stage_matches_scored) ||
        b.group_stage_exact_hits - a.group_stage_exact_hits ||
        a.display_name.localeCompare(b.display_name)
    ),
    knockout: [...all].sort(
      (a, b) =>
        b.knockout_points - a.knockout_points ||
        correctOutcomeRate(b.knockout_correct_outcomes, b.knockout_matches_scored) -
          correctOutcomeRate(a.knockout_correct_outcomes, a.knockout_matches_scored) ||
        b.knockout_exact_hits - a.knockout_exact_hits ||
        a.display_name.localeCompare(b.display_name)
    ),
  };
}

// ============================================================================
// Match insights
// ============================================================================

export interface MatchInsight {
  match_id: string;
  total_predictions: number;
  correct_outcome_count: number;
  exact_score_count: number;
  correct_outcome_rate: number;
}

export async function getMatchInsights(): Promise<Map<string, MatchInsight>> {
  // Service role -- see the comment in getStageLeaderboards() above. This is
  // a public, viewer-independent aggregate (shown to everyone on MatchCard),
  // so it must not be silently filtered by the viewer's own RLS session.
  const supabase = createServiceRoleClient();
  // Join to matches so we can compute outcomes live — no dependency on
  // score_breakdown being written to the DB by the scoring step.
  const { data, error } = await supabase
    .from("match_predictions")
    .select("match_id, predicted_home, predicted_away, predicted_winner_side, matches!inner(round, home_score, away_score, status, winner_side)")
    .eq("matches.status", "finished")
    .not("predicted_home", "is", null)
    .not("predicted_away", "is", null);
  if (error) throw error;

  const totals = new Map<string, { total: number; correct: number; exact: number }>();
  for (const row of data as unknown as Array<{
    match_id: string;
    predicted_home: number;
    predicted_away: number;
    predicted_winner_side: WinnerSide | null;
    matches: { round: Match["round"]; home_score: number | null; away_score: number | null; winner_side: WinnerSide | null } | null;
  }>) {
    if (!row.matches || row.matches.home_score === null || row.matches.away_score === null) continue;
    const { breakdown } = scoreMatchPrediction({
      predictedHome: row.predicted_home,
      predictedAway: row.predicted_away,
      actualHome: row.matches.home_score,
      actualAway: row.matches.away_score,
      isKnockout: isKnockoutRound(row.matches.round),
      predictedWinnerSide: row.predicted_winner_side,
      actualWinnerSide: row.matches.winner_side,
    });
    const t = totals.get(row.match_id) ?? { total: 0, correct: 0, exact: 0 };
    t.total += 1;
    if (breakdown.correct_outcome) t.correct += 1;
    if (breakdown.exact_score) t.exact += 1;
    totals.set(row.match_id, t);
  }

  const insights = new Map<string, MatchInsight>();
  for (const [matchId, t] of totals) {
    insights.set(matchId, {
      match_id: matchId,
      total_predictions: t.total,
      correct_outcome_count: t.correct,
      exact_score_count: t.exact,
      correct_outcome_rate: t.total > 0 ? t.correct / t.total : 0,
    });
  }
  return insights;
}

// ============================================================================
// Leaderboard breakdown — predictions visible to the current viewer
// ============================================================================

export async function getVisibleMatchPredictionsByParticipant(): Promise<Map<string, MatchPrediction[]>> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from("match_predictions").select("*");
  if (error) throw error;

  // Enrich with live-computed points so the leaderboard breakdown dropdown
  // reflects current match scores without waiting for the scoring step.
  const enriched = await enrichMatchPredictions(data as MatchPrediction[], supabase);

  const byParticipant = new Map<string, MatchPrediction[]>();
  for (const row of enriched) {
    const list = byParticipant.get(row.participant_id) ?? [];
    list.push(row);
    byParticipant.set(row.participant_id, list);
  }
  return byParticipant;
}

// ============================================================================
// Public participants view — ALL predictions visible to everyone
// ============================================================================

export async function getParticipantMatchPredictions(
  participantId: string
): Promise<MatchPrediction[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("match_predictions")
    .select("*")
    .eq("participant_id", participantId)
    .order("match_id");
  if (error) throw error;
  // Cast client to satisfy the helper type — both server and service role
  // clients expose the same SupabaseClient<Database> interface.
  return enrichMatchPredictions(
    data as MatchPrediction[],
    supabase as unknown as ReturnType<typeof createServerSupabaseClient>,
  );
}

export async function getParticipantById(
  participantId: string
): Promise<Participant | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("id", participantId)
    .maybeSingle();
  if (error) throw error;
  return (data as Participant | null) ?? null;
}

// ============================================================================
// Award accuracy — all participants' tournament picks, for the leaderboard
// accuracy display. Informational only (no points shown).
// ============================================================================

export interface AwardPickRow {
  participant_id: string;
  display_name: string;
  predicted_team_id: string | null;
  predicted_player_id: string | null;
  predicted_player_name: string | null;
  points_awarded: number | null;
}

export async function getAwardPicks(categoryKey: string): Promise<AwardPickRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("tournament_predictions")
    .select("participant_id, predicted_team_id, predicted_player_id, predicted_player_name, points_awarded, participants(display_name)")
    .eq("category_key", categoryKey);
  if (error) throw error;

  return (
    data as Array<{
      participant_id: string;
      predicted_team_id: string | null;
      predicted_player_id: string | null;
      predicted_player_name: string | null;
      points_awarded: number | null;
      participants: { display_name: string }[] | { display_name: string } | null;
    }>
  )
    .map((row) => ({
      participant_id: row.participant_id,
      display_name: (Array.isArray(row.participants) ? row.participants[0]?.display_name : row.participants?.display_name) ?? "Unknown",
      predicted_team_id: row.predicted_team_id,
      predicted_player_id: row.predicted_player_id,
      predicted_player_name: row.predicted_player_name,
      points_awarded: row.points_awarded,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

// ============================================================================
// All favourite team picks for every participant (champion / runner_up / third_place).
// Used to show favourite picks in the leaderboard dropdown and to compute the
// Favourites Leaderboard.
// ============================================================================

export interface ParticipantFavouritePicks {
  participant_id: string;
  display_name: string;
  teamIds: string[]; // up to 3
}

export async function getAllFavouritePicks(): Promise<ParticipantFavouritePicks[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("tournament_predictions")
    .select("participant_id, predicted_team_id, participants(display_name)")
    .in("category_key", ["champion", "runner_up", "third_place"])
    .not("predicted_team_id", "is", null);
  if (error) throw error;

  const byParticipant = new Map<string, ParticipantFavouritePicks>();
  for (const row of data as Array<{
    participant_id: string;
    predicted_team_id: string;
    participants: { display_name: string } | { display_name: string }[] | null;
  }>) {
    const name =
      (Array.isArray(row.participants)
        ? row.participants[0]?.display_name
        : row.participants?.display_name) ?? "Unknown";
    const existing = byParticipant.get(row.participant_id);
    if (!existing) {
      byParticipant.set(row.participant_id, {
        participant_id: row.participant_id,
        display_name: name,
        teamIds: [row.predicted_team_id],
      });
    } else {
      existing.teamIds.push(row.predicted_team_id);
    }
  }
  return Array.from(byParticipant.values());
}

// ============================================================================
// Per-participant predictions for finished matches — revealed after result
// ============================================================================

export interface MatchPredictionReveal {
  display_name: string;
  predicted_home: number;
  predicted_away: number;
  predicted_winner_side: WinnerSide | null;
  points_awarded: number | null;
  exact_score: boolean;
  correct_outcome: boolean;
}

export async function getFinishedMatchPredictions(
  matchIds: string[]
): Promise<Map<string, MatchPredictionReveal[]>> {
  if (matchIds.length === 0) return new Map();
  const supabase = createServiceRoleClient();

  // Join to matches to get scores so we can compute points live — no
  // dependency on points_awarded / score_breakdown being written to the DB.
  const { data, error } = await supabase
    .from("match_predictions")
    .select("match_id, predicted_home, predicted_away, predicted_winner_side, participants(display_name), matches!inner(round, home_score, away_score, status, winner_side)")
    .in("match_id", matchIds)
    .eq("matches.status", "finished")
    .not("predicted_home", "is", null)
    .not("predicted_away", "is", null);
  if (error) throw error;

  const result = new Map<string, MatchPredictionReveal[]>();
  for (const row of data as unknown as Array<{
    match_id: string;
    predicted_home: number;
    predicted_away: number;
    predicted_winner_side: WinnerSide | null;
    participants: { display_name: string } | { display_name: string }[] | null;
    matches: { round: Match["round"]; home_score: number | null; away_score: number | null; winner_side: WinnerSide | null } | null;
  }>) {
    if (!row.matches || row.matches.home_score === null || row.matches.away_score === null) continue;
    const { points, breakdown } = scoreMatchPrediction({
      predictedHome: row.predicted_home,
      predictedAway: row.predicted_away,
      actualHome: row.matches.home_score,
      actualAway: row.matches.away_score,
      isKnockout: isKnockoutRound(row.matches.round),
      predictedWinnerSide: row.predicted_winner_side,
      actualWinnerSide: row.matches.winner_side,
    });
    const display_name =
      (Array.isArray(row.participants)
        ? row.participants[0]?.display_name
        : row.participants?.display_name) ?? "Unknown";
    const reveal: MatchPredictionReveal = {
      display_name,
      predicted_home: row.predicted_home,
      predicted_away: row.predicted_away,
      predicted_winner_side: row.predicted_winner_side,
      points_awarded: points,
      exact_score: breakdown.exact_score ?? false,
      correct_outcome: breakdown.correct_outcome ?? false,
    };
    const list = result.get(row.match_id) ?? [];
    list.push(reveal);
    result.set(row.match_id, list);
  }

  // Sort: exact scores first, then correct outcome, then alphabetical name
  for (const preds of result.values()) {
    preds.sort((a, b) => {
      if (a.exact_score !== b.exact_score) return a.exact_score ? -1 : 1;
      if (a.correct_outcome !== b.correct_outcome) return a.correct_outcome ? -1 : 1;
      return a.display_name.localeCompare(b.display_name);
    });
  }

  return result;
}
