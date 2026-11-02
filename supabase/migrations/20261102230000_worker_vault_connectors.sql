-- The vault and connectors on a Weft Worker, T2 (docs/architecture/project-hosts.md#the-vault-on-a-worker-t2-as-built).
--
-- A worker card's mcp__secrets__list, add_blank, ask_add, set_value, push_to_vercel and its dev server's env ask the
-- owner's Mac through worker_mac_ask, as tunnels and relays do: each is a device call the Mac's Electron main re-reads
-- with its own session and answers only when it's signed by the worker's pinned pairing key. Values never travel here
-- in the clear: set_value's arrives sealed to the Mac, a dev server's goes back as a sealed `secret_use`.
-- A set_value's sealed value is blanked once it's answered, and commands carrying sealed secrets are read only by the
-- member who made them.

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

-- 3. The command kinds, restated exactly as they're live (20261102200000_signed_widening.sql added C's `pin`), so this
-- migration drops no kind whichever order the two run in. T2 adds none: lending connector tokens to a worker isn't
-- built (project-hosts.md, "Connectors on a worker: not built").
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update', 'host', 'line', 'secret_use', 'pin'));

-- 4. A command that carries sealed secrets (a secret_use's values, a Claude or GitHub sign-in) is read only by the member
-- who made it; the rest of the workspace still sees every other kind (the web board's "waiting for your Mac"). The
-- worker reads its commands through its key-checked functions, never this policy.
drop policy if exists "cloud_commands: read as member" on public.cloud_commands;
create policy "cloud_commands: read as member" on public.cloud_commands
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and (kind not in ('secret_use', 'login', 'github_login') or (select auth.uid()) = created_by)
  );

-- 5. A set_value's device call keeps no sealed value once it's answered: the bytes are sealed to the Mac's key, and a key
-- stolen later shouldn't open old values from a backup. The Mac reads args only while the call is claimed.
create or replace function private.blank_vault_set()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tool = 'vault_set' and new.status in ('done', 'failed') then
    new.args := '{}'::jsonb;
  end if;
  return new;
end;
$$;

revoke all on function private.blank_vault_set() from public, anon, authenticated;

drop trigger if exists device_calls_blank_vault_set on public.device_calls;
create trigger device_calls_blank_vault_set before update on public.device_calls
  for each row execute function private.blank_vault_set();
