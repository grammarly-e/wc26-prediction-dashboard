-- ============================================================================
-- Scoring update: add 5-pt exact-scoreline tier.
--
-- Old: RESULT_AND_GOAL_DIFF=3, RESULT_ONLY=1  (2-tier)
-- New: EXACT_SCORE=5, RESULT_AND_GOAL_DIFF=3, RESULT_ONLY=1  (3-tier)
--
-- The best_calls counter (aliased as exact_score_hits for TS compat) now
-- counts predictions where score_breakdown->>'exact_score' = 'true' (i.e.
-- the participant named the exact final score, earning 5 pts). Previously it
-- counted correct_goal_difference picks (3 pts). Tiebreaker and rank ordering
-- both updated to use the new exact-score count.
--
-- After running this migration, trigger a full recompute via the admin panel
-- ("Recompute Standings & Bracket") to rescore all existing predictions under
-- the new 5-pt tier — predictions that were previously 3-pt exact scores will
-- be bumped to 5 pts automatically.
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
    -- Top-tier calls: exact scoreline predictions (5 pts each)
    count(*) filter (where score_breakdown->>'exact_score' = 'true')                  as best_calls
  from match_predictions
  group by participant_id
) mp on mp.participant_id = p.id
left join (
  select participant_id, sum(points_awarded) as tournament_points
  from tournament_predictions
  group by participant_id
) tp on tp.participant_id = p.id;
