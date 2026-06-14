-- ============================================================================
-- Leaderboard: compute points live from match scores.
--
-- Problem: the previous view read points_awarded from match_predictions, which
-- is only written when scoreFinishedMatch() runs. If the sync job missed the
-- live→finished transition (API lag, rate-limit error, etc.), points_awarded
-- stayed NULL and the leaderboard showed 0 points even though the match result
-- was visible on match cards.
--
-- Fix: compute points directly in SQL from matches.home_score/away_score vs
-- match_predictions.predicted_home/predicted_away. The scoring rules are:
--   5 pts  exact scoreline
--   3 pts  correct goal margin (same outcome direction + same score difference)
--   2 pts  correct outcome (W/D/L direction only)
--   0 pts  miss
--
-- The view now updates automatically the moment match scores are written to the
-- matches table, with no dependency on the scoring step in the sync job.
-- ============================================================================

create or replace view leaderboard as
select
  p.id                                                    as participant_id,
  p.display_name,
  coalesce(mp.match_points, 0)                            as total_points,
  coalesce(mp.match_points, 0)                            as match_points,
  coalesce(tp.tournament_points, 0)                       as tournament_points,
  coalesce(mp.best_calls, 0)                              as exact_score_hits,
  coalesce(mp.matches_scored, 0)                          as matches_scored,
  rank() over (
    order by coalesce(mp.match_points, 0) desc,
             coalesce(mp.best_calls, 0) desc,
             p.created_at asc
  )                                                       as rank
from participants p
left join (
  select
    pred.participant_id,
    sum(
      case
        -- 5 pts: exact scoreline
        when m.home_score = pred.predicted_home
         and m.away_score = pred.predicted_away
        then 5
        -- 3 pts: correct outcome + correct goal margin
        when sign(m.home_score - m.away_score) = sign(pred.predicted_home - pred.predicted_away)
         and (m.home_score - m.away_score) = (pred.predicted_home - pred.predicted_away)
        then 3
        -- 2 pts: correct outcome (W/D/L direction only)
        when sign(m.home_score - m.away_score) = sign(pred.predicted_home - pred.predicted_away)
        then 2
        else 0
      end
    )                                                     as match_points,
    count(*)                                              as matches_scored,
    count(*) filter (
      where m.home_score = pred.predicted_home
        and m.away_score = pred.predicted_away
    )                                                     as best_calls
  from match_predictions pred
  join matches m
    on m.id = pred.match_id
   and m.status = 'finished'
   and m.home_score is not null
   and m.away_score is not null
  where pred.predicted_home is not null
    and pred.predicted_away is not null
  group by pred.participant_id
) mp on mp.participant_id = p.id
left join (
  select participant_id, sum(points_awarded) as tournament_points
  from tournament_predictions
  group by participant_id
) tp on tp.participant_id = p.id;
