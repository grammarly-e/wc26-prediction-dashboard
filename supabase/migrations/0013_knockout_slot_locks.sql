-- ============================================================================
-- Manual knockout-slot overrides + live data-fix (Iran -> Senegal)
--
-- Problem: the automatic bracket resolver (resolveKnockoutSlots() in
-- admin-recompute.ts) derives each Round of 32 "best third-placed team" slot
-- from our own DB's group standings. It placed Iran into a slot that should
-- hold Senegal -- Senegal beat Iraq 5-0 in their final group match and is
-- confirmed (FIFA official standings, cross-checked against olympics.com and
-- Al Jazeera) as one of the 8 best third-placed teams; Iran did not qualify
-- on that criterion. The likely cause is that Senegal's final group result
-- had not yet propagated into our standings at the moment the resolver last
-- ran, so Iran's already-finished Group G stats outranked Senegal's.
--
-- Fix, two parts:
--   1. team1_locked / team2_locked columns let an admin pin a knockout
--      match's team1_id/team2_id so the automatic resolver -- which re-runs
--      on every hourly sync and would otherwise silently overwrite any manual
--      fix -- skips that side from then on.
--   2. A one-time data fix: wherever Iran is currently sitting in a knockout
--      slot, replace it with Senegal and lock that side.
--
-- Run this in Supabase: Project > SQL Editor > New query > paste > Run
-- (or via the Supabase CLI: supabase db push)
-- ============================================================================

alter table matches add column if not exists team1_locked boolean not null default false;
alter table matches add column if not exists team2_locked boolean not null default false;

comment on column matches.team1_locked is 'When true, the automatic knockout-slot resolver leaves team1_id untouched (admin override).';
comment on column matches.team2_locked is 'When true, the automatic knockout-slot resolver leaves team2_id untouched (admin override).';

-- One-time fix: wherever Iran is currently resolved into a knockout slot,
-- replace it with Senegal and lock that side so the next hourly sync can't
-- put Iran back. Only one of these two statements will actually match a row
-- (Iran can only be sitting in one side of one match) -- running both is
-- harmless and avoids needing to know which side it landed on.
update matches
set team1_id = (select id from teams where name ilike '%senegal%' limit 1),
    team1_locked = true
where round <> 'Group Stage'
  and team1_id = (select id from teams where name ilike '%iran%' limit 1);

update matches
set team2_id = (select id from teams where name ilike '%senegal%' limit 1),
    team2_locked = true
where round <> 'Group Stage'
  and team2_id = (select id from teams where name ilike '%iran%' limit 1);
