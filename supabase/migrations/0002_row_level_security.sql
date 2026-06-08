-- ============================================================================
-- Row Level Security
-- Rules of the game, enforced at the database level (not just in the UI):
--   1. Live tournament data (teams, matches, standings, players, events,
--      top scorers, prediction categories) is public read-only — anyone can
--      view the dashboard without an account.
--   2. A signed-in participant can only create/edit THEIR OWN predictions,
--      and only before the relevant match kicks off / category locks.
--   3. Other participants' predictions for a given match become visible to
--      everyone once that match has kicked off — this is what makes the
--      "everyone predicts blind, then we compare" format work, and prevents
--      anyone from copying a pick after seeing it.
--   4. The leaderboard view is public so the office can watch it update live.
-- ============================================================================

alter table teams                   enable row level security;
alter table matches                 enable row level security;
alter table players                 enable row level security;
alter table match_events            enable row level security;
alter table standings               enable row level security;
alter table top_scorers             enable row level security;
alter table participants            enable row level security;
alter table prediction_categories   enable row level security;
alter table match_predictions       enable row level security;
alter table tournament_predictions  enable row level security;

-- ---- Public read-only tournament data ----
create policy "teams are publicly readable"                 on teams                 for select using (true);
create policy "matches are publicly readable"               on matches               for select using (true);
create policy "players are publicly readable"               on players               for select using (true);
create policy "match events are publicly readable"          on match_events          for select using (true);
create policy "standings are publicly readable"             on standings             for select using (true);
create policy "top scorers are publicly readable"           on top_scorers           for select using (true);
create policy "prediction categories are publicly readable" on prediction_categories for select using (true);

-- Only the service role (used by the sync job, never exposed to the browser)
-- may write to tournament data — participants never touch these tables.
create policy "service role manages teams"                on teams                 for all using (auth.role() = 'service_role');
create policy "service role manages matches"              on matches               for all using (auth.role() = 'service_role');
create policy "service role manages players"              on players               for all using (auth.role() = 'service_role');
create policy "service role manages match events"         on match_events          for all using (auth.role() = 'service_role');
create policy "service role manages standings"            on standings             for all using (auth.role() = 'service_role');
create policy "service role manages top scorers"          on top_scorers           for all using (auth.role() = 'service_role');
create policy "service role manages categories"           on prediction_categories for all using (auth.role() = 'service_role');

-- ---- Participants ----
-- Anyone can see display names (needed to render the leaderboard / "who's
-- picked" lists). A signed-in user may create exactly one participant row
-- for themselves and edit only that row.
create policy "participants are publicly readable"
  on participants for select using (true);

create policy "a user can create their own participant row"
  on participants for insert
  with check (auth.uid() = auth_user_id);

create policy "a user can update their own participant row"
  on participants for update
  using (auth.uid() = auth_user_id);

-- ---- Match predictions ----
-- Read: you can always see your own picks. You can see *anyone's* pick for
-- a given match only once that match has kicked off (kickoff_at <= now()),
-- which is what allows the leaderboard and "compare picks" views to work
-- without letting people preview each other's guesses early.
create policy "see own match predictions any time"
  on match_predictions for select
  using (
    participant_id in (select id from participants where auth_user_id = auth.uid())
  );

create policy "see others match predictions after kickoff"
  on match_predictions for select
  using (
    exists (
      select 1 from matches m
      where m.id = match_predictions.match_id
        and m.kickoff_at <= now()
    )
  );

-- Write: only your own row, and only while the match hasn't kicked off yet.
create policy "create own prediction before kickoff"
  on match_predictions for insert
  with check (
    participant_id in (select id from participants where auth_user_id = auth.uid())
    and exists (
      select 1 from matches m
      where m.id = match_predictions.match_id
        and m.kickoff_at > now()
    )
  );

create policy "edit own prediction before kickoff"
  on match_predictions for update
  using (
    participant_id in (select id from participants where auth_user_id = auth.uid())
    and exists (
      select 1 from matches m
      where m.id = match_predictions.match_id
        and m.kickoff_at > now()
    )
  );

create policy "delete own prediction before kickoff"
  on match_predictions for delete
  using (
    participant_id in (select id from participants where auth_user_id = auth.uid())
    and exists (
      select 1 from matches m
      where m.id = match_predictions.match_id
        and m.kickoff_at > now()
    )
  );

-- The sync job (service role) needs to write points_awarded/score_breakdown
-- after a match finishes — bypass the "before kickoff" rule for that role.
create policy "service role manages match predictions"
  on match_predictions for all
  using (auth.role() = 'service_role');

-- ---- Tournament predictions (champion, golden boot, group winners, etc.) ----
create policy "see own tournament predictions any time"
  on tournament_predictions for select
  using (
    participant_id in (select id from participants where auth_user_id = auth.uid())
  );

create policy "see others tournament predictions after lock"
  on tournament_predictions for select
  using (
    exists (
      select 1 from prediction_categories c
      where c.key = tournament_predictions.category_key
        and c.locks_at <= now()
    )
  );

create policy "create own tournament prediction before lock"
  on tournament_predictions for insert
  with check (
    participant_id in (select id from participants where auth_user_id = auth.uid())
    and exists (
      select 1 from prediction_categories c
      where c.key = tournament_predictions.category_key
        and c.locks_at > now()
    )
  );

create policy "edit own tournament prediction before lock"
  on tournament_predictions for update
  using (
    participant_id in (select id from participants where auth_user_id = auth.uid())
    and exists (
      select 1 from prediction_categories c
      where c.key = tournament_predictions.category_key
        and c.locks_at > now()
    )
  );

create policy "delete own tournament prediction before lock"
  on tournament_predictions for delete
  using (
    participant_id in (select id from participants where auth_user_id = auth.uid())
    and exists (
      select 1 from prediction_categories c
      where c.key = tournament_predictions.category_key
        and c.locks_at > now()
    )
  );

create policy "service role manages tournament predictions"
  on tournament_predictions for all
  using (auth.role() = 'service_role');
