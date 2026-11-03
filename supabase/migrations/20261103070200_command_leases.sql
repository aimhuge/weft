-- Leases on claimed commands (docs/architecture/weft-worker.md#leases, docs/architecture/project-hosts.md, H5). A host
-- (a Weft Worker, or a Mac's inbox: lib/host/inbox.ts) claims a command once and never retries it, so a host that died
-- mid-command left the row `claimed` until expire_cloud_commands took it 7 days later, and the board that asked waited
-- on a result that would never come. Now a claim holds a lease: lease_until, three minutes ahead. The host renews the
-- leases of the commands it's still running from its beat (lib/host/beat.ts), and at the start of a pass it puts back
-- in the queue its own commands whose lease ran out, but only those whose verb is safe to run twice: a read, never a
-- verb that makes a card or starts a turn (lib/host/lease.ts IDEMPOTENT_VERBS, flagged `idempotent` in lib/host-api).
-- A host that doesn't know about leases yet keeps working: nothing here changes what it calls or what it gets back.

-- 1. The column. Null on a command nobody holds, and on every row from before this migration.
alter table public.cloud_commands add column if not exists lease_until timestamptz;

-- 2. One rule for both ways of claiming: a row that becomes claimed gets a lease, any write to lease_until on a claimed
-- row renews it from the database's clock (never the client's value, so a Mac with a wrong clock can't hold a row for a
-- day), and a row that leaves claimed drops it. A Mac claims and renews with the account's own session, through the
-- update-own policy (created_by = auth.uid()), so lease_until joins the columns it may set.
create or replace function private.cloud_commands_lease()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.status = 'claimed' then
    if OLD.status is distinct from 'claimed' or NEW.lease_until is distinct from OLD.lease_until then
      NEW.lease_until := now() + interval '3 minutes';
    end if;
  else
    NEW.lease_until := null;
  end if;
  return NEW;
end;
$$;

revoke all on function private.cloud_commands_lease() from public, anon, authenticated;

drop trigger if exists cloud_commands_lease on public.cloud_commands;
create trigger cloud_commands_lease
  before update on public.cloud_commands
  for each row execute function private.cloud_commands_lease();

grant update (lease_until) on public.cloud_commands to authenticated;

-- An expired lease is found by the host that held it, on its own rows.
create index if not exists cloud_commands_leased
  on public.cloud_commands (target_device, lease_until)
  where status = 'claimed';

-- 3. A worker's claim, as in 20261029125616_weft_workers.sql, now with its lease said outright.
create or replace function public.worker_claim(p_key text, p_command uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  update public.cloud_commands set status = 'claimed', lease_until = now() + interval '3 minutes'
    where id = p_command and status = 'pending' and target_device = 'worker:' || w.id::text
      and created_by = w.owner_user and org_id = w.org_id;
  return found;
end;
$$;

-- 4. A worker renews the leases of the commands it's running, at most 100 at a time. Answers how many it still holds.
create or replace function public.worker_renew(p_key text, p_commands uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  held integer;
begin
  if coalesce(array_length(p_commands, 1), 0) > 100 then
    raise exception 'renew at most 100 commands at a time';
  end if;
  update public.cloud_commands set lease_until = now() + interval '3 minutes'
    where id = any(coalesce(p_commands, '{}'::uuid[])) and status = 'claimed'
      and target_device = 'worker:' || w.id::text and created_by = w.owner_user and org_id = w.org_id;
  get diagnostics held = row_count;
  return held;
end;
$$;

-- 5. Puts this worker's own expired claims back in the queue, only for `host` commands whose verb the worker names as
-- safe to run twice. The list comes from the worker (the host-api table is its source of truth), and a worker can only
-- requeue its own account's commands addressed to itself, which it could run anyway. Answers how many went back.
create or replace function public.worker_reclaim(p_key text, p_verbs text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  back integer;
begin
  if coalesce(array_length(p_verbs, 1), 0) > 100 then
    raise exception 'name at most 100 verbs';
  end if;
  update public.cloud_commands set status = 'pending', lease_until = null
    where target_device = 'worker:' || w.id::text and created_by = w.owner_user and org_id = w.org_id
      and status = 'claimed' and lease_until < now()
      and kind = 'host' and payload->>'verb' = any(coalesce(p_verbs, '{}'::text[]));
  get diagnostics back = row_count;
  return back;
end;
$$;

revoke all on function public.worker_renew(text, uuid[]) from public;
revoke all on function public.worker_reclaim(text, text[]) from public;
grant execute on function public.worker_renew(text, uuid[]) to anon, authenticated;
grant execute on function public.worker_reclaim(text, text[]) to anon, authenticated;

-- 6. The Mac's reclaim, under its own session: invoker, so the update-own policy and the column grants decide, and the
-- lease is read against the database's clock, not the Mac's.
create or replace function public.reclaim_cloud_commands(p_device text, p_verbs text[])
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  back integer;
begin
  if coalesce(array_length(p_verbs, 1), 0) > 100 then
    raise exception 'name at most 100 verbs';
  end if;
  update public.cloud_commands set status = 'pending', lease_until = null
    where target_device = p_device and created_by = (select auth.uid())
      and status = 'claimed' and lease_until < now()
      and kind = 'host' and payload->>'verb' = any(coalesce(p_verbs, '{}'::text[]));
  get diagnostics back = row_count;
  return back;
end;
$$;

revoke all on function public.reclaim_cloud_commands(text, text[]) from public, anon;
grant execute on function public.reclaim_cloud_commands(text, text[]) to authenticated;

-- 7. Expiry (20261102121500_worker_upkeep.sql): a claimed row with a lease is renewed, and so touched, while its host
-- runs it, so one untouched for a day belongs to a host that's gone. It goes after a day instead of 7. A claimed row
-- with no lease (a host older than this migration) still waits the 7 days.
create or replace function private.expire_cloud_commands()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone integer;
begin
  delete from public.cloud_commands
    where status in ('done', 'failed', 'claimed')
      -- The shortest age, so the index scans a range; the case then holds the 7-day rows back.
      and updated_at < now() - interval '1 day'
      and updated_at < now() - case
        when status = 'claimed' and lease_until is null then interval '7 days'
        when status = 'failed' and kind = 'clone' then interval '7 days'
        else interval '1 day'
      end;
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke all on function private.expire_cloud_commands() from public, anon, authenticated;
