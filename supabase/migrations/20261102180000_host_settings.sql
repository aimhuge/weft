-- Settings, limits and the game on a Weft Worker (docs/architecture/project-hosts.md#settings-on-a-worker-wp3).
--
-- 1. account_settings: the settings that shape how a card behaves wherever it runs (automations, /weft:done's model and
--    effort, push on done, the subagent model, the thread instructions, the backup model). Your Mac writes its own row;
--    each of your workers reads it with its key (worker_account_settings) and mirrors it into its settings.json. The
--    keys are an allowlist here too, so a row can never carry allowed folders, a permission mode or a guard to a worker.
--    Any session of yours can write the row, so it carries your Mac's signature (version, signature: Ed25519 by the
--    Mac's device key over the user, the version and the settings' digest, lib/account-settings-sig.ts), and a worker
--    applies only a row the Mac it was paired with signed, at a version newer than the one it has.
-- 2. cloud_workers.limits: the worker's plan-limit history (its CLI's 5-hour and weekly readings, packed by
--    lib/limits-wire.ts), written by the worker (worker_set_limits), read by your workspace like the rest of its row.

-- ─── 1. Account settings ─────────────────────────────────────────────────────
create table if not exists public.account_settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 40000),
  version    bigint check (version is null or version > 0),
  signature  text check (signature is null or length(signature) <= 200),
  updated_at timestamptz not null default now()
);

alter table public.account_settings enable row level security;
revoke all on public.account_settings from anon, authenticated;

create policy "account_settings: read own" on public.account_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "account_settings: insert own" on public.account_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "account_settings: update own" on public.account_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update on public.account_settings to authenticated;

-- The keys that may sync (packages/weft-client/src/host-settings.ts ACCOUNT_SETTINGS). Anything else in a row is dropped
-- on the way to a worker.
create or replace function private.account_setting_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['automations', 'pushOnDone', 'doneModel', 'doneEffort', 'subagentModel', 'threadPrompt', 'backupModel']; $$;

revoke all on function private.account_setting_keys() from public, anon, authenticated;

-- A worker's read of its owner's settings: the allowlisted keys, whose they are, the Mac's version and signature, and when
-- they last changed. Null when the owner has none. The worker checks the signature itself; nothing here vouches for it.
create or replace function public.worker_account_settings(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  saved public.account_settings;
begin
  select * into saved from public.account_settings where user_id = w.owner_user;
  if saved.user_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'settings', coalesce((select jsonb_object_agg(key, value) from jsonb_each(saved.settings) where key = any (private.account_setting_keys())), '{}'::jsonb),
    'user_id', saved.user_id,
    'version', saved.version,
    'signature', saved.signature,
    'updated_at', saved.updated_at
  );
end;
$$;

revoke all on function public.worker_account_settings(text) from public;
grant execute on function public.worker_account_settings(text) to anon, authenticated;

-- ─── 2. A worker's plan limits ───────────────────────────────────────────────
alter table public.cloud_workers
  add column if not exists limits jsonb check (limits is null or pg_column_size(limits) <= 65536),
  add column if not exists limits_at timestamptz;

grant select (limits, limits_at) on public.cloud_workers to authenticated;

create or replace function public.worker_set_limits(p_key text, p_limits jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception 'limits are an object';
  end if;
  update public.cloud_workers set limits = p_limits, limits_at = now() where id = w.id;
end;
$$;

revoke all on function public.worker_set_limits(text, jsonb) from public;
grant execute on function public.worker_set_limits(text, jsonb) to anon, authenticated;
