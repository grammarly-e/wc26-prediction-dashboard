-- ============================================================================
-- Leaderboard: only count points from finished matches.
--
-- Previously the view summed points_awarded from match_predictions with no
-- filter on match status. During a live match the sync job writes an
-- in-progress score to the matches row (status = 'live'). If points were ever
-- set on a live-match prediction (e.g. by a manual recompute) they would have
-- appeared in the leaderboard mid-game.
--
-- Fix: inner-join match_predictions to matches and require status = 'finished'
-- before counting any points. Live and scheduled matches are excluded.
-- ============================================================================

create or replace view leaderboard as
select
  p.id                                            as participant_id,
  p.display_name,
  coalesce(mp.match_points, 0)                    as total_points,
  coalesce(mp.match_points, 0)                    as match_points,
  coalesce(tp.tournament_points, 0)               as tournament_points,
  coalesce(mp.best_calls, 0)                      as exact_score_hits,
  coalesce(mp.matches_scored, 0)                  as matches_scored,
  rank() over (
    order by coalesce(mp.match_points, 0) desc,
             coalesce(mp.best_calls, 0) desc,
             p.created_at asc
  )                                               as rank
from participants p
left join (
  select
    pred.participant_id,
    sum(pred.points_awarded)                                                                as match_points,
    count(*) filter (where pred.points_awarded is not null)                                 as matches_scored,
    count(*) filter (where pred.score_breakdown->>'exact_score' = 'true')                   as best_calls
  from match_predictions pred
  join matches m on m.id = pred.match_id and m.status = 'finished'
  group by pred.participant_id
) mp on mp.participant_id = p.id
left join (
  select participant_id, sum(points_awarded) as tournament_points
  from tournament_predictions
  group by participant_id
) tp on tp.participant_id = p.id;
