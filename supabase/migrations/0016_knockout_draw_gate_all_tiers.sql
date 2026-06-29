-- ============================================================================
-- Extend the knockout advancing-team gate to EVERY scoring tier, not just the
-- 2pt "correct outcome" tier.
--
-- Mirrors the fix in src/lib/scoring.ts (knockoutDrawAdvancingTeamWrong):
-- the `leaderboard` view (last recreated in 0014_strict_knockout_outcome.sql)
-- independently recomputes match points in SQL rather than calling
-- scoreMatchPrediction(), so it carries its own copy of this gap and needs
-- its own fix.
--
-- Previous behaviour (0014): a wrong/missing advancing-team pick only
-- zeroed out the 2pt tier. But for a knockout match that was level at 90
-- (extra time/penalties decided it), the 5pt and 3pt tiers were reachable
-- WITHOUT the winner pick being checked at all:
--   * Predicted the exact 90-minute draw scoreline (e.g. 1-1, actual 1-1),
--     but named the wrong team to advance -- scored 5 pts even though the
--     advancing-team call, the whole point of a knockout prediction, was
--     wrong.
--   * Predicted a draw with the right goal margin but wrong scoreline (e.g.
--     0-0, actual 1-1), again with the wrong advancing-team pick -- scored
--     3 pts for the same reason.
-- This is because any two draws automatically have matching goal difference
-- (0 = 0), so "correctly called a draw at 90" alone was enough to clear the
-- 3pt (and, if the scoreline also happened to match, the 5pt) bar -- the
-- winner pick was never consulted unless the prediction fell all the way
-- through to the 2pt branch.
--
-- Fix: check the advancing-team gate FIRST, before the 5pt/3pt/2pt
-- waterfall. For a knockout match level at 90, a wrong or missing winner
-- pick now caps the prediction at 0 regardless of how close the scoreline
-- guess was. This gate is false (no effect) for every group-stage match
-- and for any knockout match decided in normal time, so no previously-
-- correct decisive-result scoring changes.
--
-- Run this in Supabase: Project > SQL Editor > New query > paste > Run
-- (or via the Supabase CLI: supabase db push)
--
-- This view recomputes live on read, so the favourites/overall leaderboard
-- corrects itself the moment this migration runs -- no rescore needed for
-- that view specifically. Per-match predicted_home/predicted_away points
-- already written to match_predictions.points_awarded by the sync job are a
-- separate, stored value (used by the stage leaderboards and individual
-- pages) and need "Recompute All" in the Admin Panel to retroactively fix
-- any already-finished knockout-draw matches that hit either bad case
-- above.
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
        -- Gate, checked first: a knockout match level at 90 (extra time/
        -- penalties decided it) with a wrong or missing advancing-team pick
        -- caps EVERY tier at 0, even an exact draw scoreline. False (no
        -- effect) for group-stage matches and for any knockout match
        -- decided in normal time. See scoring.ts module header.
        when m.round <> 'Group Stage'
         and m.home_score = m.away_score
         and not (
           pred.predicted_winner_side is not null
           and pred.predicted_winner_side = m.winner_side
         )
        then 0
        -- 5 pts: exact scoreline.
        when m.home_score = pred.predicted_home
         and m.away_score = pred.predicted_away
        then 5
        -- 3 pts: correct outcome + correct goal margin.
        when sign(m.home_score - m.away_score) = sign(pred.predicted_home - pred.predicted_away)
         and (m.home_score - m.away_score) = (pred.predicted_home - pred.predicted_away)
        then 3
        -- 2 pts: correct outcome (W/D/L direction only). Past the gate
        -- above, this is reachable only for decisive knockout/group-stage
        -- matches with the right direction but wrong margin -- a correctly
        -- called draw always satisfies the 3pt tier above instead, since a
        -- draw's goal difference is always 0 on both sides.
        when sign(m.home_score - m.away_score) = sign(pred.predicted_home - pred.predicted_away)
        then 2
        else 0
      end
    )                                                     as match_points,
    count(*)                                              as matches_scored,
    count(*) filter (
      where m.home_score = pred.predicted_home
        and m.away_score = pred.predicted_away
        and not (
          m.round <> 'Group Stage'
          and m.home_score = m.away_score
          and not (
            pred.predicted_winner_side is not null
            and pred.predicted_winner_side = m.winner_side
          )
        )
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
