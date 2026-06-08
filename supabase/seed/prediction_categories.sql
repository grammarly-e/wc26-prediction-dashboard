-- ============================================================================
-- Seed data for tournament-long prediction categories.
-- Run this in the Supabase SQL Editor AFTER 0001_init_schema.sql.
--
-- locks_at uses the actual 2026 schedule:
--   2026-06-11 = Match #1 kickoff (tournament start — group-stage picks lock)
--   2026-06-28 = Match #73 kickoff (Round of 32 starts — bracket picks lock)
-- Adjust these if you'd rather lock everything at the very start, or give
-- a grace window (e.g. lock group winners at the end of Matchday 1 instead).
-- ============================================================================

insert into prediction_categories (key, label, target_type, group_letter, points_value, locks_at, display_order) values
  -- Tournament-long awards — lock when the tournament kicks off
  ('champion',            'Tournament Champion',          'team',   null, 50, '2026-06-11T13:00:00-06:00', 1),
  ('runner_up',           'Runner-Up (Final loser)',      'team',   null, 30, '2026-06-11T13:00:00-06:00', 2),
  ('third_place',         'Third-Place Finisher',         'team',   null, 20, '2026-06-11T13:00:00-06:00', 3),
  ('golden_boot',         'Golden Boot (Top Scorer)',     'player', null, 35, '2026-06-11T13:00:00-06:00', 4),
  ('golden_ball',         'Golden Ball (Best Player)',    'player', null, 30, '2026-06-11T13:00:00-06:00', 5),
  ('best_young_player',   'Best Young Player',            'player', null, 25, '2026-06-11T13:00:00-06:00', 6),

  -- Group-stage picks — who tops each group. Locked at tournament start so
  -- everyone predicts blind based on squads/form, not after watching results.
  ('group_winner_A', 'Group A Winner', 'team', 'A', 12, '2026-06-11T13:00:00-06:00', 10),
  ('group_winner_B', 'Group B Winner', 'team', 'B', 12, '2026-06-11T13:00:00-06:00', 11),
  ('group_winner_C', 'Group C Winner', 'team', 'C', 12, '2026-06-11T13:00:00-06:00', 12),
  ('group_winner_D', 'Group D Winner', 'team', 'D', 12, '2026-06-11T13:00:00-06:00', 13),
  ('group_winner_E', 'Group E Winner', 'team', 'E', 12, '2026-06-11T13:00:00-06:00', 14),
  ('group_winner_F', 'Group F Winner', 'team', 'F', 12, '2026-06-11T13:00:00-06:00', 15),
  ('group_winner_G', 'Group G Winner', 'team', 'G', 12, '2026-06-11T13:00:00-06:00', 16),
  ('group_winner_H', 'Group H Winner', 'team', 'H', 12, '2026-06-11T13:00:00-06:00', 17),
  ('group_winner_I', 'Group I Winner', 'team', 'I', 12, '2026-06-11T13:00:00-06:00', 18),
  ('group_winner_J', 'Group J Winner', 'team', 'J', 12, '2026-06-11T13:00:00-06:00', 19),
  ('group_winner_K', 'Group K Winner', 'team', 'K', 12, '2026-06-11T13:00:00-06:00', 20),
  ('group_winner_L', 'Group L Winner', 'team', 'L', 12, '2026-06-11T13:00:00-06:00', 21),

  -- Knockout bracket picks — who reaches each stage. Locked once the Round of
  -- 32 draw is set (kickoff of match #73), so picks are made with full
  -- knowledge of the bracket but before any knockout result is known.
  ('quarterfinalist_1', 'A Quarter-Finalist (pick 1 of 8)', 'team', null, 15, '2026-06-28T12:00:00-07:00', 30),
  ('quarterfinalist_2', 'A Quarter-Finalist (pick 2 of 8)', 'team', null, 15, '2026-06-28T12:00:00-07:00', 31),
  ('semifinalist_1',    'A Semi-Finalist (pick 1 of 4)',    'team', null, 20, '2026-06-28T12:00:00-07:00', 32),
  ('semifinalist_2',    'A Semi-Finalist (pick 2 of 4)',    'team', null, 20, '2026-06-28T12:00:00-07:00', 33)
on conflict (key) do update set
  label = excluded.label,
  target_type = excluded.target_type,
  group_letter = excluded.group_letter,
  points_value = excluded.points_value,
  locks_at = excluded.locks_at,
  display_order = excluded.display_order;
