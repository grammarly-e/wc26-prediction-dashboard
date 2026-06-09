-- ============================================================================
-- Zero out all tournament prediction category points.
--
-- Tournament predictions (favourite teams, Golden Boot, Golden Ball, etc.)
-- no longer contribute to the leaderboard ranking. Group winner and bracket
-- qualifier categories have been removed from the UI entirely. This migration
-- sets points_value = 0 for every category so no future scoring job can
-- accidentally award points for them.
-- ============================================================================

update prediction_categories set points_value = 0;
