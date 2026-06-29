-- ============================================================================
-- Move the match-prediction write lock from kickoff to 15 minutes before
-- kickoff.
--
-- Previously (0002_row_level_security.sql), participants could create/edit/
-- delete their own match prediction right up until kickoff_at <= now(). That
-- meant a pick could still be changed seconds before kickoff while the
-- pre-kickoff home/draw/away consensus split (MatchCard.tsx) was potentially
-- already visible to others -- letting a late entrant's pick be informed by
-- everyone else's. Both the submission cutoff and the consensus reveal now
-- move to the same point, 15 minutes before kickoff (see
-- PICK_LOCK_LEAD_MINUTES / isLockedForPicks() in src/lib/match-utils.ts),
-- so revealing the split can never influence a pick that's still editable.
--
-- This migration touches ONLY the three write policies (insert/update/
-- delete) on match_predictions. The two select policies --
-- "see own match predictions any time" and "see others match predictions
-- after kickoff" -- are deliberately left untouched: revealing another
-- participant's *individual* pick is a separate concern from the *aggregate*
-- percentage reveal, and stays gated at the literal kickoff whistle.
--
-- Postgres has no "create or replace policy", so each policy is dropped and
-- recreated. Renamed from "... before kickoff" to "... before pick lock" so
-- the name matches what's actually enforced (matches the naming pattern
-- tournament_predictions' policies already use, e.g. "before lock").
--
-- Run this in Supabase: Project > SQL Editor > New query > paste > Run
-- (or via the Supabase CLI: supabase db push)
-- ============================================================================

drop policy if exists "create own prediction before kickoff" on match_predictions;
create policy "create own prediction before pick lock"
  on match_predictions for insert
  with check (
    participant_id in (select id from participants where auth_user_id = auth.uid())
    and exists (
      select 1 from matches m
      where m.id = match_predictions.match_id
        and m.kickoff_at > now() + interval '15 minutes'
    )
  );

drop policy if exists "edit own prediction before kickoff" on match_predictions;
create policy "edit own prediction before pick lock"
  on match_predictions for update
  using (
    participant_id in (select id from participants where auth_user_id = auth.uid())
    and exists (
      select 1 from matches m
      where m.id = match_predictions.match_id
        and m.kickoff_at > now() + interval '15 minutes'
    )
  );

drop policy if exists "delete own prediction before kickoff" on match_predictions;
create policy "delete own prediction before pick lock"
  on match_predictions for delete
  using (
    participant_id in (select id from participants where auth_user_id = auth.uid())
    and exists (
      select 1 from matches m
      where m.id = match_predictions.match_id
        and m.kickoff_at > now() + interval '15 minutes'
    )
  );
