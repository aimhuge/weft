-- The vault and connectors on a Weft Worker, T2 (docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built).
--
-- A worker card's mcp__secrets__list, add_blank, ask_add, set_value, push_to_vercel and its dev server's env ask the
-- owner's Mac through worker_mac_ask, as tunnels and relays do: each is a device call the Mac's Electron main re-reads
-- with its own session and answers only when it's signed by the worker's pinned pairing key. Values never travel here
-- in the clear: set_value's arrives sealed to the Mac, a dev server's goes back as a sealed `secret_use`.
-- Connectors (gog, gh) lent to a worker in Settings → Devices travel as a `connector` command: a short-lived token
-- sealed to the worker's box key and signed by the Mac. Finished ones keep no sealed bytes, and stale ones are failed.

-- 1. The new device-call tools, beside every one allowed before (20261102190000_worker_tunnels.sql).
alter table public.device_calls drop constraint device_calls_tool_check;
alter table public.device_calls add constraint device_calls_tool_check
  check (tool in ('list_devices', 'boot', 'install', 'launch', 'open_url', 'ui_tree', 'tap', 'swipe', 'type_text', 'press', 'screenshot', 'logs', 'watch', 'secret_run', 'tunnel_open', 'relay_create', 'vault_list', 'vault_blank', 'vault_set', 'vault_push', 'dev_env'));

-- 2. worker_mac_ask takes them, with its rules unchanged: only a card the worker owns, one ask per card and tool waiting,
-- to the owner's most recently seen desktop, or null when none has beaten in a minute.
create or replace function public.worker_mac_ask(p_key text, p_card text, p_tool text, p_args jsonb)
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
  if p_tool not in ('tunnel_open', 'relay_create', 'vault_list', 'vault_blank', 'vault_set', 'vault_push', 'dev_env') then
    raise exception 'a worker can''t ask for that' using errcode = '22023';
  end if;
  -- A sealed set_value or a dev ask is small; anything bigger isn't one Weft makes.
  if pg_column_size(coalesce(p_args, '{}'::jsonb)) > 65536 then
    raise exception 'that ask is too big' using errcode = '22023';
  end if;
  delete from public.device_calls where worker_id = w.id and created_at < now() - interval '1 hour';
  if not exists (
    select 1 from public.cloud_cards c
    where c.org_id = w.org_id and c.card_id = p_card and c.owner_worker = w.id
  ) then
    raise exception 'that card is not this worker''s' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('worker_mac_ask:' || w.id::text, 0));
  if exists (
    select 1 from public.device_calls
    where worker_id = w.id and card_id = p_card and tool = p_tool and status in ('pending', 'claimed') and created_at > now() - interval '10 minutes'
  ) then
    raise exception 'that card already has an approval waiting' using errcode = '53400';
  end if;
  select d.device into mac from public.cloud_workers d
    where d.kind = 'desktop' and d.owner_user = w.owner_user and d.org_id = w.org_id and d.device is not null
      and d.revoked_at is null and d.last_seen_at > now() - interval '60 seconds'
    order by d.last_seen_at desc
    limit 1;
  if mac is null then
    return null;
  end if;
  perform set_config('weft.mac_ask', w.id::text, true);
  insert into public.device_calls (org_id, owner_user, worker_id, target_device, card_id, tool, args)
    values (w.org_id, w.owner_user, w.id, mac, p_card, p_tool, coalesce(p_args, '{}'::jsonb))
    returning id into made;
  perform set_config('weft.mac_ask', '', true);
  return made;
end;
$$;

revoke all on function public.worker_mac_ask(text, text, text, jsonb) from public;
grant execute on function public.worker_mac_ask(text, text, text, jsonb) to anon, authenticated;

-- These come only through worker_mac_ask, with its one-at-a-time limit, never through worker_device_call.
create or replace function private.device_calls_approval_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tool in ('tunnel_open', 'relay_create', 'vault_list', 'vault_blank', 'vault_set', 'vault_push', 'dev_env')
    and coalesce(current_setting('weft.mac_ask', true), '') <> new.worker_id::text then
    raise exception 'a worker asks for that with worker_mac_ask' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.device_calls_approval_origin() from public, anon, authenticated;

-- 3. The `connector` kind, beside every kind allowed before (20261102170000_secret_use.sql, H6's `line`).
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update', 'host', 'line', 'secret_use', 'connector'));

-- 4. A finished connector command keeps no sealed bytes either, like a secret_use: a seal-key.json stolen later can't
-- open an old token from a backup.
create or replace function private.blank_secret_use()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind in ('secret_use', 'connector') and new.status in ('done', 'failed') then
    new.payload := '{}'::jsonb;
  end if;
  return new;
end;
$$;

-- 5. One nobody took is failed (so blanked): a secret_use after 10 minutes, as before; a connector token after an hour,
-- by which time the Mac has sent a newer one (every 40 minutes for Google) and Google's has run out.
create or replace function private.sweep_secret_use()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone integer;
  more integer;
begin
  update public.cloud_commands
    set status = 'failed', error = 'expired before the worker took it', updated_at = now()
    where kind = 'secret_use' and status = 'pending' and created_at < now() - interval '10 minutes';
  get diagnostics gone = row_count;
  update public.cloud_commands
    set status = 'failed', error = 'expired before the worker took it', updated_at = now()
    where kind = 'connector' and status = 'pending' and created_at < now() - interval '1 hour';
  get diagnostics more = row_count;
  return gone + more;
end;
$$;

revoke all on function private.sweep_secret_use() from public, anon, authenticated;
