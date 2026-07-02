-- Migration 0017: award_winners
-- Stores the admin-declared winner for each award category.
-- No automatic scoring is triggered by inserts here; the display
-- on the leaderboard page simply reads from this table and shows
-- the announced winner alongside participants' predictions.
--
-- Run in Supabase SQL Editor.

create table if not exists public.award_winners (
  category_key  text        primary key,
  winner_name   text        not null,
  declared_at   timestamptz not null default now()
);

alter table public.award_winners enable row level security;

-- Anyone can read the declared winners (used on the public leaderboard page).
create policy "award_winners_public_read"
  on public.award_winners
  for select
  using (true);

-- Writes are service-role only (admin route uses service-role client).
-- No insert/update RLS policy needed — service role bypasses RLS.
