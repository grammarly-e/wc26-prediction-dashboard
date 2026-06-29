-- ============================================================================
-- Strict W/D/L gate on the knockout "correct outcome" tier (2 pts).
--
-- Mirrors the fix in src/lib/scoring.ts: the `leaderboard` view (last
-- recreated in 0012_knockout_winner_predictions.sql) independently
-- recomputes match points in SQL rather than calling scoreMatchPrediction(),
-- so it carries its own copy of this bug and needs its own fix.
--
-- Previous behaviour: for knockout matches, the 2pt tier was awarded purely
-- off predicted_winner_side = matches.winner_side, with no check that the
-- predicted scoreline's W/D/L direction made any sense against the actual
-- 90-minutes-+-stoppage result. That let two wrong cases score 2 pts:
--   * Predicted a draw (e.g. 1-1), actual was decided outright in normal
--     time (e.g. 2-1) -- the winner pick still happened to name the team
--     that led at 90, even though the draw prediction itself was wrong.
--   * Predicted a decisive win (e.g. 2-0 team1), actual was level at 90 and
--     decided in extra time/penalties -- the winner pick still happened to
--     name the eventual winner, even though "this ends in normal time" was
--     wrong.
--
-- Fix: the scoreline's W/D/L direction (sign-of-difference comparison,
-- exactly what the group-stage branch already uses) must match first. Only
-- when it matches AND the actual 90-minute score was itself level does the
-- explicit winner pick get an additional say -- that's the one genuinely
-- ambiguous case it exists to resolve ("correctly called a draw at 90, AND
-- correctly called who advances"). Tiers 5 and 3 (exact score, goal diff)
-- are untouched.
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
-- any already-finished knockout matches that hit either bad case above.
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
        -- 5 pts: exact scoreline (knockout-agnostic — a perfect call is a
        -- perfect call regardless of how the winner pick went).
        when m.home_score = pred.predicted_home
         and m.away_score = pred.predicted_away
        then 5
        -- 3 pts: correct outcome + correct goal margin (scoreline-only,
        -- unchanged for knockout matches — see scoring.ts for why this tier
        -- doesn't need the explicit winner pick).
        when sign(m.home_score - m.away_score) = sign(pred.predicted_home - pred.predicted_away)
         and (m.home_score - m.away_score) = (pred.predicted_home - pred.predicted_away)
        then 3
        -- 2 pts: correct outcome. First gate, for every match including
        -- knockout: the predicted scoreline's W/D/L direction must match
        -- the actual W/D/L at 90+stoppage. If it doesn't, 0 -- no winner
        -- pick can rescue a wrong scoreline call.
        when sign(m.home_score - m.away_score) <> sign(pred.predicted_home - pred.predicted_away)
        then 0
        -- W/D/L direction already matches at this point. For knockout
        -- matches where the actual 90-minute score was itself level (extra
        -- time/penalties decided it), the explicit winner pick must
        -- additionally match the actual winner -- the one genuinely
        -- ambiguous case it exists to resolve.
        when m.round <> 'Group Stage' and m.home_score = m.away_score then
          case
            when pred.predicted_winner_side is not null
             and pred.predicted_winner_side = m.winner_side
            then 2
            else 0
          end
        -- W/D/L direction matches and (group stage, or knockout decided in
        -- normal time) -- already fully correct.
        else 2
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
