// Hand-written types matching supabase/migrations/0001_init_schema.sql.
// If you change the schema, run `supabase gen types typescript` to regenerate
// these properly — this file is a practical starting point so the app
// type-checks without the Supabase CLI.

export type MatchStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";
export type MatchRound =
  | "Group Stage"
  | "Round of 32"
  | "Round of 16"
  | "Quarter-final"
  | "Semi-final"
  | "Match for third place"
  | "Final";
export type EventType =
  | "goal"
  | "own_goal"
  | "penalty_goal"
  | "penalty_missed"
  | "yellow_card"
  | "red_card"
  | "substitution";
export type CategoryTargetType = "team" | "player";
/**
 * Positional winner reference (team1/team2 slot, not a team UUID) — mirrors
 * predicted_home/predicted_away, which are also slot-positional so a pick
 * survives before a knockout bracket slot resolves to an actual team.
 * Used for matches.winner_side (actual result) and
 * match_predictions.predicted_winner_side (the participant's pick). See
 * supabase/migrations/0012_knockout_winner_predictions.sql.
 */
export type WinnerSide = "team1" | "team2";

export interface Team {
  id: string;
  name: string;
  fifa_code: string | null;
  confederation: string | null;
  group_letter: string | null;
  fifa_rank: number | null;
  is_placeholder: boolean;
  flag_emoji: string | null;
  created_at: string;
}

export interface Match {
  id: string;
  match_number: number;
  round: MatchRound;
  matchday: string | null;
  group_letter: string | null;
  kickoff_at: string;
  venue: string;
  host_city: string | null;
  team1_code: string;
  team2_code: string;
  team1_id: string | null;
  team2_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: MatchStatus;
  external_id: string | null;
  updated_at: string;
  /** Actual winner, including penalty-shootout outcomes. Null for a group-stage draw. */
  winner_side: WinnerSide | null;
  /** Admin override locks -- when true, the automatic knockout-slot resolver
   *  leaves the corresponding team_id untouched. See migration 0013. */
  team1_locked: boolean;
  team2_locked: boolean;
}

export interface Player {
  id: string;
  team_id: string;
  name: string;
  position: string | null;
  shirt_number: number | null;
  external_id: string | null;
  created_at: string;
}

export interface MatchEvent {
  id: string;
  match_id: string;
  team_id: string | null;
  player_id: string | null;
  player_name: string | null;
  minute: number | null;
  event_type: EventType;
  detail: string | null;
  created_at: string;
}

export interface Standing {
  id: string;
  group_letter: string;
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  rank: number | null;
  updated_at: string;
}

export interface TopScorer {
  id: string;
  player_id: string | null;
  player_name: string;
  team_id: string | null;
  goals: number;
  assists: number;
  rank: number | null;
  updated_at: string;
}

export interface Participant {
  id: string;
  auth_user_id: string | null;
  display_name: string;
  created_at: string;
}

export interface PredictionCategory {
  key: string;
  label: string;
  target_type: CategoryTargetType;
  group_letter: string | null;
  points_value: number;
  locks_at: string;
  display_order: number;
}

export interface ScoreBreakdown {
  exact_score?: boolean;
  correct_outcome?: boolean;
  correct_goal_difference?: boolean;
  close_approximation?: boolean;
  points_exact?: number;
  points_outcome?: number;
  points_goal_diff?: number;
  points_approximation?: number;
  total?: number;
}

export interface MatchPrediction {
  id: string;
  participant_id: string;
  match_id: string;
  predicted_home: number;
  predicted_away: number;
  submitted_at: string;
  updated_at: string;
  points_awarded: number | null;
  score_breakdown: ScoreBreakdown | null;
  /** Explicit winner pick for knockout matches — null/unused for group stage. */
  predicted_winner_side: WinnerSide | null;
}

export interface TournamentPrediction {
  id: string;
  participant_id: string;
  category_key: string;
  predicted_team_id: string | null;
  predicted_player_id: string | null;
  predicted_player_name: string | null;
  submitted_at: string;
  updated_at: string;
  points_awarded: number | null;
}

export interface LeaderboardRow {
  participant_id: string;
  display_name: string;
  total_points: number;
  match_points: number;
  tournament_points: number;
  exact_score_hits: number;
  matches_scored: number;
  rank: number;
}

// Minimal Supabase `Database` shape so `createBrowserClient<Database>` /
// `createServerClient<Database>` type-check. Expand with `supabase gen types`
// for full type safety on `.from(...)` calls if you want it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
