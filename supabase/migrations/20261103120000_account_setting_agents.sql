-- Your agents on a Weft Worker (docs/architecture/agents.md#on-a-weft-worker): the agents you made and edited in
-- Settings → Agents, and each worker project's default agent, travel in your account_settings row as one more signed
-- key, `agents` (packages/weft-client/src/host-settings.ts ACCOUNT_SETTINGS, lib/agent-sync.ts). A worker mirrors them
-- only from the Mac it was paired with, as it does the thread instructions.
--
-- 1. The allowlist gains `agents`. The worker's read drops keys not on it before it checks the Mac's signature, so this
--    must be applied before a Mac that sends `agents` ships, or that Mac's rows fail the check on every worker.
-- 2. Souls are long (up to 20,000 characters each), so the row's size cap grows from 40 KB to 400 KB. The Mac caps the
--    agents it sends below that (lib/agent-sync.ts SNAPSHOT_MAX_CHARS) and drops them when the row is refused.

create or replace function private.account_setting_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['automations', 'pushOnDone', 'doneModel', 'doneEffort', 'subagentModel', 'threadPrompt', 'backupModel', 'agents']; $$;

revoke all on function private.account_setting_keys() from public, anon, authenticated;

alter table public.account_settings drop constraint if exists account_settings_settings_check;
alter table public.account_settings
  add constraint account_settings_settings_check check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 400000);
