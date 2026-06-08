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

import { createServerSupabaseClient } from "./supabase/server";
import type {
  LeaderboardRow,
  MatchPrediction,
  Participant,
  PredictionCategory,
  TournamentPrediction,
} from "./types";

/**
 * The signed-in participant viewing this request, or null if nobody's signed
 * in yet (no session) or they have a session but haven't picked a display
 * name yet (no `participants` row — see JoinForm).
 */
export async function getCurrentParticipant(): Promise<Participant | null> {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  return (data as Participant | null) ?? null;
}

/** All 22 award categories, in display order — used to render the category-pick page. */
export async function getPredictionCategories(): Promise<PredictionCategory[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("prediction_categories")
    .select("*")
    .order("display_order", { ascending: true });
  if (error) throw error;
  return data as PredictionCategory[];
}

/** This participant's match-by-match predictions, keyed by match_id for quick lookup in the UI. */
export async function getMyMatchPredictions(participantId: string): Promise<Map<string, MatchPrediction>> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("match_predictions")
    .select("*")
    .eq("participant_id", participantId);
  if (error) throw error;

  return new Map((data as MatchPrediction[]).map((p) => [p.match_id, p]));
}

/** This participant's tournament-long category picks, keyed by category_key. */
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

/** The full standings table — public view, safe for anyone to read. */
export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("leaderboard")
    .select("*")
    .order("rank", { ascending: true });
  if (error) throw error;
  return data as LeaderboardRow[];
}
