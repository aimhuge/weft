-- A Goose provider's key for a Weft Worker card's turn (docs/architecture/weft-worker.md#goose-on-a-worker). The key lives
-- in the paired Mac's Keychain; a worker's Goose turn whose provider takes one asks that Mac with a `goose_key` device
-- call, signed by the worker's pairing key, through worker_mac_ask like a dev server's `dev_env`. The Mac's Electron main
-- re-reads the row, answers only for the provider and endpoint it last set on that worker, after Touch ID, and sends the
-- key back as a sealed, Mac-signed `secret_use` (use "goose"), which the existing kind, maker-only read policy and
-- blanking already cover. Additive: one device-call tool, in the three places that list them, and nothing else changed.

-- 1. The tool, beside every one allowed before (20261102230000_worker_vault_connectors.sql was the last to list them).
alter table public.device_calls drop constraint device_calls_tool_check;
alter table public.device_calls add constraint device_calls_tool_check
  check (tool in ('list_devices', 'boot', 'install', 'launch', 'open_url', 'ui_tree', 'tap', 'swipe', 'type_text', 'press', 'screenshot', 'logs', 'watch', 'secret_run', 'tunnel_open', 'relay_create', 'vault_list', 'vault_blank', 'vault_set', 'vault_push', 'dev_env', 'goose_key'));

-- 2. worker_mac_ask takes it, restated from 20261103080000_worker_pairing_mac.sql with only the tool list changed: a card
-- the worker owns, one ask per card and tool waiting, and (strict, like the vault's tools) only to the paired Mac.
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
  if p_tool not in ('tunnel_open', 'relay_create', 'vault_list', 'vault_blank', 'vault_set', 'vault_push', 'dev_env', 'goose_key') then
    raise exception 'a worker can''t ask for that' using errcode = '22023';
  end if;
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
  mac := private.ask_mac_for(w, p_tool not in ('tunnel_open', 'relay_create'));
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

-- 3. It comes only through worker_mac_ask, with its one-at-a-time limit, never through worker_device_call
-- (20261102230000_worker_vault_connectors.sql's, with only the tool list changed).
create or replace function private.device_calls_approval_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tool in ('tunnel_open', 'relay_create', 'vault_list', 'vault_blank', 'vault_set', 'vault_push', 'dev_env', 'goose_key')
    and coalesce(current_setting('weft.mac_ask', true), '') <> new.worker_id::text then
    raise exception 'a worker asks for that with worker_mac_ask' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.device_calls_approval_origin() from public, anon, authenticated;
