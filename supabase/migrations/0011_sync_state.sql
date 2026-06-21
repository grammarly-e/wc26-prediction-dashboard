-- ============================================================================
-- Sync state — tracks when the sync job last actually ran, independent of
-- matches.updated_at (which gets bumped by ANY update to a match row,
-- including unrelated admin edits via the admin panel -- this previously
-- polluted the "last synced at" signal shown on the dashboard, making it
-- look like a sync had just happened when really an admin had just tweaked
-- a score).
--
-- Single-row table: id is always `true`, so a second insert collides with
-- the primary key and runSync() must upsert rather than insert. See
-- src/lib/sync.ts::runSync() (writer) and src/lib/data.ts::getLastSyncedAt()
-- (reader, with a fallback to MAX(matches.updated_at) for the period before
-- this migration has been applied or before the first sync run completes).
-- ============================================================================

create table sync_state (
  id              boolean primary key default true check (id),
  last_synced_at  timestamptz not null,
  last_message    text
);

alter table sync_state enable row level security;

-- Public read, so the dashboard can show "last synced" without needing the
-- service role -- same pattern as teams/matches/standings etc.
create policy "sync state is publicly readable"
  on sync_state for select using (true);

create policy "service role manages sync state"
  on sync_state for all using (auth.role() = 'service_role');
