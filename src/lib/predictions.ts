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
  Match,
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

// ============================================================================
// Stage-split leaderboard
//
// The `leaderboard` view sums match points across the whole tournament — but
// the group stage (Matchdays 1–17, matches #1–72) and the knockout rounds
// (Round of 32 through the Final, #73–104) are different games of skill: one
// rewards reading 12 separate group dynamics, the other rewards calling
// single-elimination upsets. Splitting them surfaces a "group stage champion"
// and a "knockout stage champion" alongside the overall leaderboard.
//
// There's no view for this in the schema, so it's computed here by reading
// scored predictions (points_awarded is only ever set once a match has
// finished — i.e. after kickoff, which is exactly when RLS opens up everyone's
// picks for that match — so this aggregate is always complete, never partial).
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

/**
 * Per-participant match points, split into group-stage vs. knockout-stage
 * totals, each sorted descending (so index 0 is that stage's leader).
 */
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

  // Supabase's untyped client infers embedded-resource selects (`matches(round)`)
  // as an array (`{ round }[]`) because it can't read the FK cardinality off
  // generated schema types. At runtime, match_predictions.match_id -> matches.id
  // is many-to-one, so postgrest actually returns a single object (or null) here
  // — hence the indirection through `unknown` rather than a direct `as`, which
  // TS correctly refuses (array and object shapes aren't comparable).
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
// "Compare picks" — every match prediction the current viewer is allowed to
// see, grouped by the participant who made it.
//
// RLS (supabase/migrations/0002_*) does the filtering for us: this returns
// the viewer's own picks regardless of timing, plus everyone else's picks
// only for matches that have already kicked off. That's exactly the right
// shape for a "click a name to see their breakdown" feature — nobody can
// preview a pick before the match locks, but once it has, comparisons are
// fair game.
// ============================================================================

/** Every visible match prediction, grouped by participant_id. */
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
