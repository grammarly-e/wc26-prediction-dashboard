-- ============================================================================
-- Knockout-stage winner predictions.
--
-- Group stage matches can end in a draw, so the existing "correct outcome"
-- tier (2 pts) is derived purely from comparing predicted vs actual W/D/L on
-- the scoreline. Knockout matches can NOT end in a draw (a winner always
-- advances), so participants now make a second, explicit prediction for
-- knockout matches: who wins, independent of the scoreline they also predict
-- for the 90min+extra-time score (penalty-shootout goals already excluded —
-- see regulationAndExtraTimeScore() in src/lib/providers/football-data.ts).
--
-- Positional, not team-FK: mirrors predicted_home/predicted_away, which are
-- also positional (team1/team2 slot) rather than tied to a resolved team
-- row — this lets a participant predict the winner of "Round of 32 Match 73"
-- before that bracket slot resolves to an actual team.
--
-- Scoring impact (src/lib/scoring.ts): exact-score (5pt) and goal-diff (3pt)
-- tiers stay scoreline-driven, unchanged. Only the 2pt "correct outcome" tier
-- changes for knockout matches — it now compares predicted_winner_side
-- against matches.winner_side instead of the scoreline's W/D/L direction.
--
-- matches.winner_side is populated for ALL matches (group + knockout) from
-- the provider's score.winner field (sync.ts), null for a group-stage draw.
-- This also fixes a latent bug in admin-recompute.ts's resolveSlotCode():
-- W73/L73-style bracket slot codes previously resolved the winner by
-- comparing home_score/away_score, which is wrong for any knockout match
-- decided on penalties (those columns hold the 90min+ET score, i.e. a tie).
-- ============================================================================

alter table matches
  add column winner_side text check (winner_side in ('team1', 'team2'));

alter table match_predictions
  add column predicted_winner_side text check (predicted_winner_side in ('team1', 'team2'));

comment on column matches.winner_side is
  'Actual match winner (team1/team2 slot, not team UUID), including penalty-shootout outcomes. Null for group-stage draws.';
comment on column match_predictions.predicted_winner_side is
  'Participant''s explicit winner pick for knockout matches (team1/team2 slot). Null/unused for group-stage rows — those derive outcome from the scoreline.';

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
        -- 2 pts: correct outcome. Knockout matches use the explicit winner
        -- pick (no draw possible in the final outcome); group stage keeps
        -- the scoreline-derived W/D/L direction.
        when m.round <> 'Group Stage' then
          case
            when pred.predicted_winner_side is not null
             and pred.predicted_winner_side = m.winner_side
            then 2
            else 0
          end
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
