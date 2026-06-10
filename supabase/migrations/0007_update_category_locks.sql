-- Update the 6 main prediction categories to lock on June 15 00:00 UTC
-- instead of June 11 (tournament kickoff). This gives participants more time
-- to enter their favourite teams and award picks during the opening days.

update prediction_categories
set locks_at = '2026-06-15T00:00:00Z'
where key in (
  'champion',
  'runner_up',
  'third_place',
  'golden_boot',
  'golden_ball',
  'best_young_player'
);
