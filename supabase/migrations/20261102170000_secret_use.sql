-- Secrets on a Weft Worker, the per-use seal (docs/architecture/project-hosts.md#secrets-on-a-worker-h8-the-per-use-seal-as-built).
-- A worker card's mcp__secrets__run asks its owner's Mac with a `secret_run` device call (names, never values). Electron
-- main approves with Touch ID, seals the values to the worker's X25519 key for that card, ask and command, and queues a
-- `secret_use` command. Supabase only ever carries names and sealed bytes.

-- 1. The kind. Every kind already allowed stays, and `line` (H6, landing beside this) is listed too: H6's migration lists
-- `secret_use` as well, so whichever is applied last still allows both.
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update', 'host', 'line', 'secret_use'));

-- 2. A finished secret_use keeps no sealed bytes: a seal-key.json stolen later can't open an old row from a backup.
create or replace function private.blank_secret_use()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'secret_use' and new.status in ('done', 'failed') then
    new.payload := '{}'::jsonb;
  end if;
  return new;
end;
$$;

drop trigger if exists cloud_commands_blank_secret_use on public.cloud_commands;
create trigger cloud_commands_blank_secret_use
  before update of status on public.cloud_commands
  for each row execute function private.blank_secret_use();

-- 2b. A secret_use nobody claimed is dead once its ask has expired (5 minutes, lib/secret-use.ts ASK_MS): failing it
-- blanks it through the trigger above. Swept on each new ask, and every 5 minutes where pg_cron is on.
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
    where kind = 'secret_use' and status = 'pending' and created_at < now() - interval '10 minutes';
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke all on function private.sweep_secret_use() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sweep-secret-use', '*/5 * * * *', 'select private.sweep_secret_use()');
  end if;
end;
$$;

-- 3. The ask travels worker to Mac in device_calls, beside Local Simulator mode's tools.
alter table public.device_calls drop constraint device_calls_tool_check;
alter table public.device_calls add constraint device_calls_tool_check
  check (tool in ('list_devices', 'boot', 'install', 'launch', 'open_url', 'ui_tree', 'tap', 'swipe', 'type_text', 'press', 'screenshot', 'logs', 'watch', 'secret_run'));

-- Queues a card's secret ask for the owner's most recently seen desktop, or null when none has beaten in a minute. The
-- card has to be this worker's. The Mac re-reads the row with its own session before it asks the user anything.
create or replace function public.worker_secret_ask(p_key text, p_card text, p_args jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  mac text;
  made uuid;
begin
  delete from public.device_calls where worker_id = w.id and created_at < now() - interval '1 hour';
  perform private.sweep_secret_use();
  if not exists (
    select 1 from public.cloud_cards c
    where c.org_id = w.org_id and c.card_id = p_card and c.owner_worker = w.id
  ) then
    raise exception 'that card is not this worker''s' using errcode = '42501';
  end if;
  -- One ask per card waiting at a time, and a few per worker: a thread can't stack approvals on the Mac. The lock makes
  -- the count and the insert one step per worker, so two asks at once can't both slip under the cap.
  perform pg_advisory_xact_lock(hashtextextended('worker_secret_ask:' || w.id::text, 0));
  if exists (select 1 from public.device_calls where worker_id = w.id and card_id = p_card and tool = 'secret_run' and status in ('pending', 'claimed') and created_at > now() - interval '10 minutes') then
    raise exception 'that card already has a secret ask waiting' using errcode = '53400';
  end if;
  if (select count(*) from public.device_calls where worker_id = w.id and tool = 'secret_run' and status in ('pending', 'claimed') and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many secret asks waiting on this worker' using errcode = '53400';
  end if;
  select d.device into mac from public.cloud_workers d
    where d.kind = 'desktop' and d.owner_user = w.owner_user and d.org_id = w.org_id and d.device is not null
      and d.last_seen_at > now() - interval '60 seconds'
    order by d.last_seen_at desc
    limit 1;
  if mac is null then
    return null;
  end if;
  insert into public.device_calls (org_id, owner_user, worker_id, target_device, card_id, tool, args)
    values (w.org_id, w.owner_user, w.id, mac, p_card, 'secret_run', coalesce(p_args, '{}'::jsonb))
    returning id into made;
  return made;
end;
$$;

revoke all on function public.worker_secret_ask(text, text, jsonb) from public;
grant execute on function public.worker_secret_ask(text, text, jsonb) to anon, authenticated;
