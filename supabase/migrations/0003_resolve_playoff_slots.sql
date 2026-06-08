-- ============================================================================
-- Resolve playoff-slot placeholder teams to their now-confirmed identities.
--
-- The intercontinental and UEFA playoff paths have all concluded. The six
-- placeholder rows seed.ts created ("UEFA Path A/B/C/D winner", "IC Path 1/2
-- winner") can now be renamed in place to the real qualified teams. Because
-- matches.team1_id/team2_id already reference these rows by id, renaming is
-- the entire fix — MatchCard, the prediction pickers, and the standings joins
-- all resolve display names via team_id -> teams.name, so this propagates
-- everywhere with no other changes required.
--
-- Run this in Supabase: Project > SQL Editor > New query > paste > Run
-- (or via the Supabase CLI: supabase db push)
-- ============================================================================

update teams set name = 'Bosnia and Herzegovina', is_placeholder = false, group_letter = 'B', confederation = 'UEFA' where name = 'UEFA Path A winner';
update teams set name = 'Sweden',                  is_placeholder = false, group_letter = 'F', confederation = 'UEFA' where name = 'UEFA Path B winner';
update teams set name = 'Türkiye',                 is_placeholder = false, group_letter = 'D', confederation = 'UEFA' where name = 'UEFA Path C winner';
update teams set name = 'Czechia',                 is_placeholder = false, group_letter = 'A', confederation = 'UEFA' where name = 'UEFA Path D winner';
update teams set name = 'DR Congo',                is_placeholder = false, group_letter = 'K', confederation = 'CAF'  where name = 'IC Path 1 winner';
update teams set name = 'Iraq',                    is_placeholder = false, group_letter = 'I', confederation = 'AFC'  where name = 'IC Path 2 winner';
