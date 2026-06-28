// ============================================================================
// Server-side data access for the prediction-submission and leaderboard pages.
//
// Counterpart to src/lib/data.ts (which handles the read-only live-tournament
// views). Everything here either reads/writes participant-owned rows -- which
// RLS (supabase/migrations/0002_row_level_security.sql) restricts to "your
// own, before kickoff/lock" -- or reads the public `leaderboard` view.
//
// Identity: participants sign in via Supabase anonymous auth (just a display
// name, no email/password -- see JoinForm.tsx). `getCurrentParticipant()` is
// the single source of truth for "who is looking at this page right now,"
// and every page below should call it before deciding what to render.
// ============================================================================

import { createServerSupabaseClient, createServiceRoleClient } from "./supabase/server";
import { scoreMatchPrediction } from "./scoring";
import { correctOutcomeRate, hasKickedOff, isKnockoutRound } from "./match-utils";
import { getMatches } from "./data";
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
// Pagination helper
//
// Supabase/PostgREST caps a bare `.select()` at 1000 rows by default, no
// matter how many rows actually match the query, and a capped read does NOT
// error -- it just silently returns the first page. Any query below that
// scans match_predictions across ALL participants (instead of one
// participant's own rows, which always fits) can cross that cap well before
// the tournament ends: 18 participants x up to 104 matches each is up to
// 1,872 rows, already past 1,000 by the third group-stage matchday alone.
// Whichever participants' rows fell outside the first page then silently
// lose those matches' points on the leaderboard -- while a participant's own
// page (filtered to .eq("participant_id", ...), max 104 rows) never hits the
// cap and stays correct. That split is exactly what produced "individual
// page is right, leaderboard is short by some flat amount" for one
// participant rather than everyone equally.
//
// Fix: page through with .range() until a page comes back shorter than a
// full page, accumulating every row, instead of trusting a single .select().
// ============================================================================

const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  // `data` is typed `unknown` (not `T[]`) on purpose: Supabase's inferred
  // type for a joined `select()` (e.g. `matches!inner(...)`) often doesn't
  // structurally match the hand-written row type callers want here, the same
  // reason call sites in this file previously needed `as unknown as Array<...>`.
  // Trusting the caller's generic via a single cast here, instead of forcing
  // every call site to fight the join typing, reproduces that same trust
  // without repeating the cast at every call site.
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data as T[] | null) ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// ============================================================================
// Live-scoring enrichment helper
//
// Replaces stale/null points_awarded and score_breakdown on MatchPredictions
// with values computed directly from match scores -- the same rules used by
// the leaderboard SQL view in migration 0010. Predictions for unfinished
// matches are returned unchanged (points_awarded remains null).
//
// This is the single function that decides what any prediction is worth.
// getParticipantMatchPredictions() (the individual page) and
// getStageLeaderboards() (the public leaderboard) both call it on the same
// raw rows, so the two views cannot disagree about a match's points.
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
  // Service role -- no viewer-scoped RLS on a public, shared total.
  const supabase = createServiceRoleClient();

  const [allPredictions, participantsRes, matchesRes] = await Promise.all([
    fetchAllRows<MatchPrediction>((from, to) =>
      supabase.from("match_predictions").select("*").range(from, to)
    ),
    supabase.from("participants").select("id, display_name"),
    supabase.from("matches").select("id, round"),
  ]);
  if (participantsRes.error) throw participantsRes.error;
  if (matchesRes.error) throw matchesRes.error;

  const participantsList = participantsRes.data as Array<{ id: string; display_name: string }>;
  const nameById = new Map(participantsList.map((p) => [p.id, p.display_name]));
  const roundByMatchId = new Map(
    (matchesRes.data as Array<{ id: string; round: Match["round"] }>).map((m) => [m.id, m.round])
  );

  // Deliberately the SAME enrichment call getParticipantMatchPredictions()
  // (the individual page) uses on the same raw rows -- one function decides
  // what a prediction is worth, used in both places, so the public
  // leaderboard total and a participant's own page total cannot diverge.
  const enriched = await enrichMatchPredictions(allPredictions, supabase);

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
  // populated from day one -- the knockout table shows everyone at 0 points
  // rather than disappearing until the first knockout match finishes.
  for (const p of participantsList) rowFor(p.id);

  for (const pred of enriched) {
    // enrichMatchPredictions() only assigns a non-null points_awarded when it
    // found a finished match with both scores set -- so this is exactly the
    // "has this match actually scored" check, using the same decision the
    // individual page relies on, not a second independent one.
    if (pred.points_awarded === null || pred.points_awarded === undefined) continue;
    const round = roundByMatchId.get(pred.match_id);
    if (!round) continue;

    const row = rowFor(pred.participant_id);
    const isExact = pred.score_breakdown?.exact_score ?? false;
    const isCorrect = pred.score_breakdown?.correct_outcome ?? false;
    if (isKnockoutRound(round)) {
      row.knockout_points += pred.points_awarded;
      row.knockout_matches_scored += 1;
      if (isExact) row.knockout_exact_hits += 1;
      if (isCorrect) row.knockout_correct_outcomes += 1;
    } else {
      row.group_stage_points += pred.points_awarded;
      row.group_stage_matches_scored += 1;
      if (isExact) row.group_stage_exact_hits += 1;
      if (isCorrect) row.group_stage_correct_outcomes += 1;
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
  // Join to matches so we can compute outcomes live -- no dependency on
  // score_breakdown being written to the DB by the scoring step. Paginated
  // (see fetchAllRows) -- this scans every participant's predictions for
  // every finished match, which crosses the 1000-row default cap well
  // before the tournament ends.
  const data = await fetchAllRows<{
    match_id: string;
    predicted_home: number;
    predicted_away: number;
    predicted_winner_side: WinnerSide | null;
    matches: { round: Match["round"]; home_score: number | null; away_score: number | null; winner_side: WinnerSide | null } | null;
  }>((from, to) =>
    supabase
      .from("match_predictions")
      .select("match_id, predicted_home, predicted_away, predicted_winner_side, matches!inner(round, home_score, away_score, status, winner_side)")
      .eq("matches.status", "finished")
      .not("predicted_home", "is", null)
      .not("predicted_away", "is", null)
      .range(from, to)
  );

  const totals = new Map<string, { total: number; correct: number; exact: number }>();
  for (const row of data) {
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
// Leaderboard breakdown -- predictions visible to the current viewer
// ============================================================================

/**
 * All match predictions, grouped by participant, with one restriction: a
 * pick for a match that hasn't kicked off yet is stripped out unless it
 * belongs to the viewer themselves. "Picks lock the moment a match kicks
 * off, so everyone's guessing blind" (see /predictions copy) only holds if
 * this function actually withholds the data -- the caller (leaderboard
 * page) hands the result straight to LeaderboardTable.tsx, a "use client"
 * component, so anything returned here gets serialized into the page's RSC
 * payload and is inspectable in the browser regardless of how the
 * component chooses to render it. Filtering has to happen here, before that
 * boundary, not at render time.
 */
export async function getVisibleMatchPredictionsByParticipant(
  viewerParticipantId: string | null
): Promise<Map<string, MatchPrediction[]>> {
  const supabase = createServerSupabaseClient();
  // Paginated (see fetchAllRows) -- scans every participant's predictions,
  // which crosses the 1000-row default cap well before the tournament ends.
  const allPredictions = await fetchAllRows<MatchPrediction>((from, to) =>
    supabase.from("match_predictions").select("*").range(from, to)
  );

  // Enrich with live-computed points so the leaderboard breakdown dropdown
  // reflects current match scores without waiting for the scoring step.
  const enriched = await enrichMatchPredictions(allPredictions, supabase);

  // Kickoff lookup -- a pick is safe to reveal once its match has kicked
  // off, regardless of who's viewing.
  const matches = await getMatches();
  const kickedOffByMatchId = new Map(matches.map((m) => [m.id, hasKickedOff(m)]));

  const byParticipant = new Map<string, MatchPrediction[]>();
  for (const row of enriched) {
    const isOwnPick = viewerParticipantId !== null && row.participant_id === viewerParticipantId;
    if (!isOwnPick && !kickedOffByMatchId.get(row.match_id)) continue;
    const list = byParticipant.get(row.participant_id) ?? [];
    list.push(row);
    byParticipant.set(row.participant_id, list);
  }
  return byParticipant;
}

// ============================================================================
// Participant prediction-sheet view -- raw rows, unfiltered.
//
// Returns every one of this participant's predictions regardless of
// kickoff. NOT safe to render directly to a viewer who isn't this
// participant -- the caller (participants/[id]/page.tsx) is responsible for
// withholding predicted_home/predicted_away/predicted_winner_side for any
// match that hasn't kicked off yet, unless the viewer is this participant.
// Filtering happens at render time there rather than here because that page
// is a plain Server Component with no client component receiving the raw
// values, so an unrendered pick never reaches the browser -- contrast with
// getVisibleMatchPredictionsByParticipant() above, which filters at the data
// layer because its caller hands the result to a "use client" component.
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
  // Cast client to satisfy the helper type -- both server and service role
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
// Award accuracy -- all participants' tournament picks, for the leaderboard
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
// Per-participant predictions for finished matches -- revealed after result
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

  // Join to matches to get scores so we can compute points live -- no
  // dependency on points_awarded / score_breakdown being written to the DB.
  // Paginated (see fetchAllRows): matchIds here is "every finished match"
  // (see src/app/page.tsx), so this is every participant's prediction for
  // every finished match -- crosses the 1000-row default cap well before
  // the tournament ends.
  const data = await fetchAllRows<{
    match_id: string;
    predicted_home: number;
    predicted_away: number;
    predicted_winner_side: WinnerSide | null;
    participants: { display_name: string } | { display_name: string }[] | null;
    matches: { round: Match["round"]; home_score: number | null; away_score: number | null; winner_side: WinnerSide | null } | null;
  }>((from, to) =>
    supabase
      .from("match_predictions")
      .select("match_id, predicted_home, predicted_away, predicted_winner_side, participants(display_name), matches!inner(round, home_score, away_score, status, winner_side)")
      .in("match_id", matchIds)
      .eq("matches.status", "finished")
      .not("predicted_home", "is", null)
      .not("predicted_away", "is", null)
      .range(from, to)
  );

  const result = new Map<string, MatchPredictionReveal[]>();
  for (const row of data) {
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
