-- A worker's asks go to the Mac it's paired with, and a revoked pairing Mac stops being trusted on the worker
-- (docs/architecture/device-registry.md#the-pairing-mac, project-hosts.md "route asks to the pairing Mac").
--
-- 1. cloud_workers.paired_mac: the device id (lib/device-id.ts) of the Mac that opened the pairing this worker was made
--    from. That Mac's code carried the approval key the box pinned (lib/worker-mac-keys.ts), so it's the one Mac whose
--    secret answers the worker takes. Written only by a trigger when worker_pair_confirm marks the pairing paired (no
--    column grant), filled for every worker paired before. Routing only: nothing trusts it for a yes, since the worker
--    checks every answer against the key it pinned, so a wrong value at worst sends an ask where nobody can answer it.
-- 2. worker_secret_ask and worker_mac_ask send secret runs and vault asks only to that Mac, while it's beating; with it
--    away they return null (the worker says the paired Mac isn't open) instead of handing the ask to another Mac, whose
--    answer the worker would refuse. Tunnels and relays, which any of the owner's Macs may approve, try the paired Mac
--    first and fall back to the newest beat, as before. A token-enrolled worker (no pairing) keeps the newest beat.
-- 3. worker_mac_state(key): whether this worker's pairing Mac has been revoked (its heartbeat row, or its key row named
--    by host_device). The worker polls it and stops trusting that Mac's key for good (lib/worker-mac-revocation.ts).
--    Revocation never comes back (the keep-revoked triggers), so the worker's mark never has to be undone.

alter table public.cloud_workers add column if not exists paired_mac text
  check (paired_mac is null or char_length(paired_mac) between 1 and 100);
grant select (paired_mac) on public.cloud_workers to authenticated;

create or replace function private.worker_paired_mac()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purpose = 'worker' and new.status = 'paired' and new.worker_id is not null
     and (old.status is distinct from 'paired' or old.worker_id is distinct from new.worker_id) then
    update public.cloud_workers set paired_mac = new.mac_device
      where id = new.worker_id and kind = 'headless' and revoked_at is null;
  end if;
  return new;
end;
$$;

revoke all on function private.worker_paired_mac() from public, anon, authenticated;

drop trigger if exists phone_pairings_worker_paired_mac on public.phone_pairings;
create trigger phone_pairings_worker_paired_mac after update on public.phone_pairings
  for each row execute function private.worker_paired_mac();

-- Every worker paired before this: the pairing that made it names its Mac. A revoked row is left alone (the keep-revoked
-- trigger refuses any update to it, and it takes no asks anyway).
update public.cloud_workers w
   set paired_mac = p.mac_device
  from public.phone_pairings p
 where p.worker_id = w.id and p.purpose = 'worker' and p.status = 'paired'
   and w.kind = 'headless' and w.paired_mac is null and w.revoked_at is null;

-- The Mac an ask goes to: the paired Mac while it beat in the last minute; else, when `strict`, none; else the owner's
-- newest live Mac in the worker's workspace (and that too for a worker with no pairing Mac).
create or replace function private.ask_mac_for(w public.cloud_workers, p_strict boolean)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select d.device from public.cloud_workers d
      where w.paired_mac is not null and d.kind = 'desktop' and d.owner_user = w.owner_user and d.org_id = w.org_id
        and d.device = w.paired_mac and d.revoked_at is null and d.last_seen_at > now() - interval '60 seconds'
      limit 1),
    (select d.device from public.cloud_workers d
      where (w.paired_mac is null or not p_strict) and d.kind = 'desktop' and d.owner_user = w.owner_user
        and d.org_id = w.org_id and d.device is not null and d.revoked_at is null
        and d.last_seen_at > now() - interval '60 seconds'
      order by d.last_seen_at desc
      limit 1)
  );
$$;

revoke all on function private.ask_mac_for(public.cloud_workers, boolean) from public, anon, authenticated;

-- 20261102170000_secret_use.sql's, routed to the pairing Mac (and a revoked Mac's beat no longer counts).
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
  perform pg_advisory_xact_lock(hashtextextended('worker_secret_ask:' || w.id::text, 0));
  if exists (select 1 from public.device_calls where worker_id = w.id and card_id = p_card and tool = 'secret_run' and status in ('pending', 'claimed') and created_at > now() - interval '10 minutes') then
    raise exception 'that card already has a secret ask waiting' using errcode = '53400';
  end if;
  if (select count(*) from public.device_calls where worker_id = w.id and tool = 'secret_run' and status in ('pending', 'claimed') and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many secret asks waiting on this worker' using errcode = '53400';
  end if;
  mac := private.ask_mac_for(w, true);
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

-- 20261102230000_worker_vault_connectors.sql's, routed the same way: the vault's tools only to the pairing Mac (main
-- answers only a worker it pinned), tunnels and relays to it first.
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

-- The worker's pairing Mac, and whether it was revoked: a revoked heartbeat row under its device id, or a revoked key
-- row that names it as host. Anyone holding the owner's session can revoke a Mac (device_revoke), so this can only
-- take trust away, never give it.
create or replace function public.worker_mac_state(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if w.paired_mac is null then
    return jsonb_build_object('mac', null, 'revoked', false);
  end if;
  return jsonb_build_object('mac', w.paired_mac, 'revoked', (
    exists (select 1 from public.cloud_workers d
             where d.kind = 'desktop' and d.owner_user = w.owner_user and d.device = w.paired_mac and d.revoked_at is not null)
    or exists (select 1 from public.devices k
                where k.user_id = w.owner_user and k.host_device = w.paired_mac and k.revoked_at is not null)
  ));
end;
$$;

revoke all on function public.worker_mac_state(text) from public;
grant execute on function public.worker_mac_state(text) to anon, authenticated;
