-- ============================================================================
-- Scoring system update: 0/1/3 pts
--
-- Old: EXACT_SCORE=25, RESULT_AND_GOAL_DIFF=15, RESULT_ONLY=8, CLOSE_CALL=3
-- New: RESULT_AND_GOAL_DIFF=3, RESULT_ONLY=1, no exact / close-call tiers
--
-- The `exact_hits` counter in the leaderboard view previously counted
-- predictions whose score_breakdown->>'exact_score' = 'true'. With the new
-- system, the equivalent top-tier is "correct result + correct goal diff"
-- (score_breakdown->>'correct_goal_difference' = 'true'), so we update the
-- view to count that instead. The column is renamed from exact_score_hits to
-- best_calls for clarity — but keep the leaderboard view column alias so
-- downstream TS types (exact_score_hits) still work without a schema change.
--
-- After running this migration, trigger a full recompute via the admin panel
-- ("Recompute Standings & Bracket") to rescore all existing predictions under
-- the new point values.
-- ============================================================================

create or replace view leaderboard as
select
  p.id                                            as participant_id,
  p.display_name,
  coalesce(mp.match_points, 0)                    as total_points,
  coalesce(mp.match_points, 0)                    as match_points,
  coalesce(tp.tournament_points, 0)               as tournament_points,
  coalesce(mp.best_calls, 0)                      as exact_score_hits,   -- kept for TS compat
  coalesce(mp.matches_scored, 0)                  as matches_scored,
  rank() over (
    order by coalesce(mp.match_points, 0) desc,
             coalesce(mp.best_calls, 0) desc,
             p.created_at asc
  )                                               as rank
from participants p
left join (
  select
    participant_id,
    sum(points_awarded)                                                               as match_points,
    count(*) filter (where points_awarded is not null)                                as matches_scored,
    -- Top-tier calls: correct result AND correct goal difference (3 pts each)
    count(*) filter (where score_breakdown->>'correct_goal_difference' = 'true')      as best_calls
  from match_predictions
  group by participant_id
) mp on mp.participant_id = p.id
left join (
  select participant_id, sum(points_awarded) as tournament_points
  from tournament_predictions
  group by participant_id
) tp on tp.participant_id = p.id;
