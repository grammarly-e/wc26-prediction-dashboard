-- ============================================================================
-- Tournament award picks are now tracked separately from the main leaderboard.
-- The rank and displayed total now reflect match-prediction points only.
-- Tournament prediction points are still stored and shown in their own section,
-- but they no longer affect standing or rank.
-- ============================================================================

create or replace view leaderboard as
select
  p.id                                            as participant_id,
  p.display_name,
  coalesce(mp.match_points, 0)                    as total_points,   -- match picks only
  coalesce(mp.match_points, 0)                    as match_points,
  coalesce(tp.tournament_points, 0)               as tournament_points,  -- kept for display, not ranked
  coalesce(mp.exact_hits, 0)                      as exact_score_hits,
  coalesce(mp.matches_scored, 0)                  as matches_scored,
  rank() over (
    order by coalesce(mp.match_points, 0) desc,   -- rank by match picks only
             coalesce(mp.exact_hits, 0) desc,
             p.created_at asc
  )                                               as rank
from participants p
left join (
  select
    participant_id,
    sum(points_awarded)                                                    as match_points,
    count(*) filter (where points_awarded is not null)                     as matches_scored,
    count(*) filter (where score_breakdown->>'exact_score' = 'true')       as exact_hits
  from match_predictions
  group by participant_id
) mp on mp.participant_id = p.id
left join (
  select participant_id, sum(points_awarded) as tournament_points
  from tournament_predictions
  group by participant_id
) tp on tp.participant_id = p.id;
