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
import type {
  LeaderboardRow,
  Match,
  MatchPrediction,
  Participant,
  PredictionCategory,
  ScoreBreakdown,
  TournamentPrediction,
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
  return new Map((data as MatchPrediction[]).map((p) => [p.match_id, p]));
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
  knockout_points: number;
  knockout_matches_scored: number;
}

function isKnockoutRound(round: Match["round"]): boolean {
  return round !== "Group Stage";
}

export async function getStageLeaderboards(): Promise<{
  groupStage: StageLeaderboardRow[];
  knockout: StageLeaderboardRow[];
}> {
  const supabase = createServerSupabaseClient();
  const [predictionsRes, participantsRes] = await Promise.all([
    supabase
      .from("match_predictions")
      .select("participant_id, points_awarded, matches(round)")
      .not("points_awarded", "is", null),
    supabase.from("participants").select("id, display_name"),
  ]);
  if (predictionsRes.error) throw predictionsRes.error;
  if (participantsRes.error) throw participantsRes.error;

  const nameById = new Map(
    (participantsRes.data as Array<{ id: string; display_name: string }>).map((p) => [p.id, p.display_name])
  );

  const totals = new Map<string, StageLeaderboardRow>();
  function rowFor(participantId: string): StageLeaderboardRow {
    let row = totals.get(participantId);
    if (!row) {
      row = {
        participant_id: participantId,
        display_name: nameById.get(participantId) ?? "Unknown",
        group_stage_points: 0,
        group_stage_matches_scored: 0,
        knockout_points: 0,
        knockout_matches_scored: 0,
      };
      totals.set(participantId, row);
    }
    return row;
  }

  for (const pred of predictionsRes.data as unknown as Array<{
    participant_id: string;
    points_awarded: number | null;
    matches: { round: Match["round"] } | null;
  }>) {
    if (pred.points_awarded === null || !pred.matches) continue;
    const row = rowFor(pred.participant_id);
    if (isKnockoutRound(pred.matches.round)) {
      row.knockout_points += pred.points_awarded;
      row.knockout_matches_scored += 1;
    } else {
      row.group_stage_points += pred.points_awarded;
      row.group_stage_matches_scored += 1;
    }
  }

  const all = Array.from(totals.values());
  return {
    groupStage: [...all].sort((a, b) => b.group_stage_points - a.group_stage_points),
    knockout: [...all].sort((a, b) => b.knockout_points - a.knockout_points),
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
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("match_predictions")
    .select("match_id, score_breakdown")
    .not("points_awarded", "is", null);
  if (error) throw error;

  const totals = new Map<string, { total: number; correct: number; exact: number }>();
  for (const row of data as Array<{ match_id: string; score_breakdown: ScoreBreakdown | null }>) {
    if (!row.score_breakdown) continue;
    const t = totals.get(row.match_id) ?? { total: 0, correct: 0, exact: 0 };
    t.total += 1;
    if (row.score_breakdown.correct_outcome) t.correct += 1;
    if (row.score_breakdown.exact_score) t.exact += 1;
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

  const byParticipant = new Map<string, MatchPrediction[]>();
  for (const row of data as MatchPrediction[]) {
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
  return data as MatchPrediction[];
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
      participants: { display_name: string } | null;
    }>
  )
    .map((row) => ({
      participant_id: row.participant_id,
      display_name: row.participants?.display_name ?? "Unknown",
      predicted_team_id: row.predicted_team_id,
      predicted_player_id: row.predicted_player_id,
      predicted_player_name: row.predicted_player_name,
      points_awarded: row.points_awarded,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}
