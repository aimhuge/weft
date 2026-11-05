-- "Keep on this worker": the vault on a Weft Worker (docs/architecture/secrets.md#kept-on-a-worker; project-hosts.md H8's
-- last step). The Mac sends a project's development or preview values to a paired worker as a `vault_keep` command,
-- each value sealed to the worker's box key and the whole command signed with the Mac's device key; it takes them back
-- (a delete, drop or wipe) the same way. Supabase carries only sealed bytes and names. Additive: one command kind, the
-- maker-only read that sealed commands already have, and the same blanking and sweep as a secret_use.

-- 1. The kind, every live kind restated (20261102230000_worker_vault_connectors.sql was the last to list them).
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update', 'host', 'line', 'secret_use', 'pin', 'vault_keep'));

-- 2. A vault_keep carries sealed values, so only the member who made it reads it, as a secret_use or a sign-in.
drop policy if exists "cloud_commands: read as member" on public.cloud_commands;
create policy "cloud_commands: read as member" on public.cloud_commands
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and (kind not in ('secret_use', 'login', 'github_login', 'vault_keep') or (select auth.uid()) = created_by)
  );

-- 3. A finished vault_keep keeps no sealed bytes: the worker has stored them, and a seal-key.json stolen later shouldn't
-- open them from a backup of this table. The same trigger function blanks a secret_use.
create or replace function private.blank_secret_use()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind in ('secret_use', 'vault_keep') and new.status in ('done', 'failed') then
    new.payload := '{}'::jsonb;
  end if;
  return new;
end;
$$;

-- 4. A put the worker never took is dead after 10 minutes (it refuses one older than that, lib/worker-keep-wire.ts
-- KEEP_MAX_AGE_MS), so it's failed, and so blanked, with the secret_use sweep. A delete, drop or wipe stays pending
-- until the worker comes back: it only takes values away, and it carries no value.
create or replace function private.sweep_secret_use()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone integer;
begin
  update public.cloud_commands
    set status = 'failed', error = 'expired before the worker took it', updated_at = now()
    where status = 'pending' and created_at < now() - interval '10 minutes'
      and (kind = 'secret_use' or (kind = 'vault_keep' and payload->'keep'->>'op' = 'put'));
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke all on function private.sweep_secret_use() from public, anon, authenticated;
