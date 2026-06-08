-- ============================================================================
-- World Cup 2026 Prediction Dashboard — initial schema
-- Run this in Supabase: Project > SQL Editor > New query > paste > Run
-- (or via the Supabase CLI: supabase db push)
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- TEAMS
-- One row per national team (and a few placeholder rows for playoff slots
-- that aren't resolved yet, e.g. "UEFA Path A winner" — is_placeholder = true).
-- ----------------------------------------------------------------------------
create table teams (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  fifa_code       text,                 -- 3-letter code, e.g. 'BRA'
  confederation   text,                 -- UEFA, CONMEBOL, CONCACAF, CAF, AFC, OFC
  group_letter    char(1),              -- 'A'..'L', null for unresolved playoff slots
  fifa_rank       int,
  is_placeholder  boolean not null default false,
  flag_emoji      text,
  created_at      timestamptz not null default now()
);

create index idx_teams_group on teams (group_letter);

-- ----------------------------------------------------------------------------
-- MATCHES
-- All 104 matches, group stage through the Final. Knockout matches reference
-- their slot codes (e.g. '1A' = Group A winner, 'W74' = winner of match 74)
-- via team1_code/team2_code until the actual team is known, at which point
-- team1_id/team2_id get filled in by the sync job.
-- ----------------------------------------------------------------------------
create table matches (
  id              uuid primary key default gen_random_uuid(),
  match_number    int not null unique check (match_number between 1 and 104),
  round           text not null,        -- 'Group Stage' | 'Round of 32' | 'Round of 16' | 'Quarter-final' | 'Semi-final' | 'Match for third place' | 'Final'
  matchday        text,                 -- 'Matchday 1'..'Matchday 17' for group stage, null for knockout
  group_letter    char(1),              -- 'A'..'L' for group stage, null for knockout
  kickoff_at      timestamptz not null,
  venue           text not null,
  host_city       text,
  team1_code      text not null,        -- raw slot/team label from the official schedule
  team2_code      text not null,
  team1_id        uuid references teams(id),
  team2_id        uuid references teams(id),
  home_score      int,
  away_score      int,
  status          text not null default 'scheduled'
                    check (status in ('scheduled','live','finished','postponed','cancelled')),
  external_id     text,                 -- id of this match in the live-data provider, for syncing
  updated_at      timestamptz not null default now()
);

create index idx_matches_round on matches (round);
create index idx_matches_group on matches (group_letter);
create index idx_matches_kickoff on matches (kickoff_at);
create unique index idx_matches_external on matches (external_id) where external_id is not null;

-- ----------------------------------------------------------------------------
-- PLAYERS
-- Squad rosters. Populated from the live-data provider once squads are
-- announced (typically a few weeks before the tournament).
-- ----------------------------------------------------------------------------
create table players (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id) on delete cascade,
  name            text not null,
  position        text,                 -- Goalkeeper | Defender | Midfielder | Forward
  shirt_number    int,
  external_id     text,
  created_at      timestamptz not null default now()
);

create index idx_players_team on players (team_id);
create unique index idx_players_external on players (external_id) where external_id is not null;

-- ----------------------------------------------------------------------------
-- MATCH EVENTS
-- Goal-by-goal / card-by-card feed for a match — what drives the live match
-- view and the top-scorer leaderboard.
-- ----------------------------------------------------------------------------
create table match_events (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches(id) on delete cascade,
  team_id         uuid references teams(id),
  player_id       uuid references players(id),
  player_name     text,                 -- fallback when the player isn't in our roster table yet
  minute          int,
  event_type      text not null check (event_type in
                    ('goal','own_goal','penalty_goal','penalty_missed','yellow_card','red_card','substitution')),
  detail          text,
  created_at      timestamptz not null default now()
);

create index idx_events_match on match_events (match_id);
create index idx_events_player on match_events (player_id);
create index idx_events_type on match_events (event_type);

-- ----------------------------------------------------------------------------
-- STANDINGS (materialized by the sync job from live results — simpler and
-- faster for the UI than recomputing FIFA tie-break rules on every page load)
-- ----------------------------------------------------------------------------
create table standings (
  id              uuid primary key default gen_random_uuid(),
  group_letter    char(1) not null,
  team_id         uuid not null references teams(id) on delete cascade,
  played          int not null default 0,
  won             int not null default 0,
  drawn           int not null default 0,
  lost            int not null default 0,
  goals_for       int not null default 0,
  goals_against   int not null default 0,
  goal_diff       int generated always as (goals_for - goals_against) stored,
  points          int not null default 0,
  rank            int,
  updated_at      timestamptz not null default now(),
  unique (group_letter, team_id)
);

create index idx_standings_group on standings (group_letter, rank);

-- ----------------------------------------------------------------------------
-- TOP SCORERS (materialized by the sync job — Golden Boot race)
-- ----------------------------------------------------------------------------
create table top_scorers (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid references players(id),
  player_name     text not null,
  team_id         uuid references teams(id),
  goals           int not null default 0,
  assists         int not null default 0,
  rank            int,
  updated_at      timestamptz not null default now(),
  unique (player_name, team_id)
);

create index idx_top_scorers_rank on top_scorers (rank);

-- ----------------------------------------------------------------------------
-- PARTICIPANTS
-- A participant is identified by a display name/nickname only (no real-name
-- requirement). Linked to a Supabase Auth user so people can only edit their
-- own predictions, but the public leaderboard only ever shows display_name.
-- ----------------------------------------------------------------------------
create table participants (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique references auth.users(id) on delete cascade,
  display_name    text not null unique,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- PREDICTION CATEGORIES (configurable tournament-long award categories)
-- target_type tells the UI whether to show a team picker or a player picker.
-- locks_at is when that category stops accepting changes (e.g. kickoff of
-- match #1 for "champion", or kickoff of match #73 once the bracket is set).
-- ----------------------------------------------------------------------------
create table prediction_categories (
  key             text primary key,        -- e.g. 'champion', 'golden_boot', 'group_winner_A'
  label           text not null,           -- e.g. 'Tournament Champion'
  target_type     text not null check (target_type in ('team','player')),
  group_letter    char(1),                 -- set for per-group categories like 'group_winner_A'
  points_value    int not null default 10,
  locks_at        timestamptz not null,
  display_order   int not null default 0
);

-- ----------------------------------------------------------------------------
-- MATCH PREDICTIONS
-- One row per (participant, match): their exact scoreline guess. Locks at
-- kickoff. points_awarded/score_breakdown are filled in once the match ends.
-- ----------------------------------------------------------------------------
create table match_predictions (
  id                  uuid primary key default gen_random_uuid(),
  participant_id      uuid not null references participants(id) on delete cascade,
  match_id            uuid not null references matches(id) on delete cascade,
  predicted_home      int not null check (predicted_home >= 0),
  predicted_away      int not null check (predicted_away >= 0),
  submitted_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  points_awarded      int,
  score_breakdown     jsonb,
  unique (participant_id, match_id)
);

create index idx_match_predictions_participant on match_predictions (participant_id);
create index idx_match_predictions_match on match_predictions (match_id);

-- ----------------------------------------------------------------------------
-- TOURNAMENT PREDICTIONS
-- One row per (participant, category): champion, golden boot, group winners,
-- knockout-stage team picks, etc. predicted_team_id / predicted_player_id
-- depending on the category's target_type.
-- ----------------------------------------------------------------------------
create table tournament_predictions (
  id                  uuid primary key default gen_random_uuid(),
  participant_id      uuid not null references participants(id) on delete cascade,
  category_key        text not null references prediction_categories(key) on delete cascade,
  predicted_team_id   uuid references teams(id),
  predicted_player_id uuid references players(id),
  predicted_player_name text,             -- fallback if the player isn't in our roster table
  submitted_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  points_awarded      int,
  unique (participant_id, category_key)
);

create index idx_tournament_predictions_participant on tournament_predictions (participant_id);

-- ----------------------------------------------------------------------------
-- LEADERBOARD VIEW
-- Sums match-prediction points + tournament-prediction points per participant.
-- Ties are broken by who has the most exact-scoreline hits (a nice, fair
-- tiebreak that rewards precision), then by earliest signup.
-- ----------------------------------------------------------------------------
create or replace view leaderboard as
select
  p.id                                            as participant_id,
  p.display_name,
  coalesce(mp.match_points, 0) + coalesce(tp.tournament_points, 0) as total_points,
  coalesce(mp.match_points, 0)                    as match_points,
  coalesce(tp.tournament_points, 0)               as tournament_points,
  coalesce(mp.exact_hits, 0)                      as exact_score_hits,
  coalesce(mp.matches_scored, 0)                  as matches_scored,
  rank() over (
    order by coalesce(mp.match_points, 0) + coalesce(tp.tournament_points, 0) desc,
             coalesce(mp.exact_hits, 0) desc,
             p.created_at asc
  )                                               as rank
from participants p
left join (
  select
    participant_id,
    sum(points_awarded)                                  as match_points,
    count(*) filter (where points_awarded is not null)   as matches_scored,
    count(*) filter (where score_breakdown->>'exact_score' = 'true') as exact_hits
  from match_predictions
  group by participant_id
) mp on mp.participant_id = p.id
left join (
  select participant_id, sum(points_awarded) as tournament_points
  from tournament_predictions
  group by participant_id
) tp on tp.participant_id = p.id;

-- ----------------------------------------------------------------------------
-- updated_at maintenance triggers
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_matches_updated_at before update on matches
  for each row execute function set_updated_at();

create trigger trg_match_predictions_updated_at before update on match_predictions
  for each row execute function set_updated_at();

create trigger trg_tournament_predictions_updated_at before update on tournament_predictions
  for each row execute function set_updated_at();
