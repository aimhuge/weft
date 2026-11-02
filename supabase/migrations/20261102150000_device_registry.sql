-- H10: one device registry and one pairing flow (docs/architecture/project-hosts.md, "Devices and records";
-- docs/architecture/device-registry.md).
--
-- Before this, three registries: public.devices (Macs' vault keys, paired phones and browsers), public.cloud_workers
-- (headless workers by key, and `desktop` heartbeat rows) and public.phone_pairings (the QR claim). Nothing moves out
-- of them here: the phone app still writes phone_pairings and devices, install/worker.sh still trades a token through
-- worker_enrol, and every existing function keeps its signature. What this adds:
--
-- 1. public.device_registry, a security_invoker view over the three: every host and view as one row with its kind
--    (mac, worker, phone, browser), owner, org, keys (box, sign, passkey), host address and last seen. It reads the
--    tables as the caller, so their RLS and column grants decide what a row shows; it grants nothing.
-- 2. One revocation for every kind: cloud_workers.revoked_at (kept once set, like devices.revoked_at), and
--    device_revoke(id), which revokes a key device, a Mac's host row or a worker. A revoked worker's key_hash is
--    replaced, so every check that looks a worker up by its key (worker_for_key, the worker-blob and worker-build
--    routes, the wake and presence topics) stops finding it without any of them changing.
-- 3. Enrolling a worker as pairing a host: phone_pairings rows with purpose = 'worker'. The Mac opens one
--    (worker_pair_open), the box claims it with its keys, the hash of a key it made itself, an HMAC proof with the
--    code's secret and an Ed25519 signature (worker_pair_claim), the Mac checks both and asks Touch ID, then confirms
--    (worker_pair_confirm), which makes the cloud_workers row. The box learns it's paired through worker_pair_status,
--    which only answers the key whose hash it claimed. The worker's identity stays a key checked by sha256 in
--    worker_for_key; the difference is that the key never crosses the network to be issued.
--
-- No device gains a capability: workers get no public.devices row (so no vault or workspace-key grant can be wrapped
-- to them by a "every device of yours" loop), a worker pairing can't be claimed as a phone or the other way round, and
-- confirm makes exactly what worker_enrol made, for the caller and in a workspace they're a member of.

-- ─── devices: the Mac's host address, and H7's passkey columns ──────────────
-- host_device is the Mac's lib/device-id.ts id, which its cloud_cards rows, commands and desktop heartbeat use, so
-- the registry can show a Mac's key row and its host row as one. Set by the owner (electron/device-beat.cjs); RLS
-- keeps it to their own rows, so a wrong value only merges two of their own Macs in their own list.
alter table public.devices add column if not exists host_device text
  check (host_device is null or host_device ~ '^[0-9a-f]{64}$');
create index if not exists devices_host_idx on public.devices (user_id, host_device) where host_device is not null;
grant select (host_device) on public.devices to authenticated;
grant update (host_device) on public.devices to authenticated;

-- The same columns and checks as 20261102130000_passkey_approvals.sql, so the view below has them whichever lands
-- first; both statements are no-ops when they're already there.
alter table public.devices add column if not exists passkey_id text check (char_length(passkey_id) <= 1400);
alter table public.devices add column if not exists passkey_key text check (char_length(passkey_key) <= 400);
grant select (passkey_id, passkey_key) on public.devices to authenticated;

-- Macs that already paired a phone said which device id goes with which key: fill host_device from those.
update public.devices d
   set host_device = p.mac_device
  from (
    select distinct on (user_id, mac_key) user_id, mac_key, mac_device
      from public.phone_pairings
     where mac_device ~ '^[0-9a-f]{64}$'
     order by user_id, mac_key, created_at desc
  ) p
 where d.kind = 'desktop' and d.host_device is null and d.user_id = p.user_id and d.public_key = p.mac_key;

-- Only the row's own user names its host. An org admin may update a device row (the "devices: admin revoke" policy, to
-- revoke it), and must not be able to point it at another Mac's host row and merge or revoke that one. Postgres roles
-- with no session (the migration's backfill above, the service role) aren't asked.
create or replace function private.devices_own_host()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.host_device is distinct from old.host_device and current_user in ('anon', 'authenticated')
     and (select auth.uid()) is distinct from old.user_id then
    raise exception 'Only a device''s owner names its host.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists devices_own_host on public.devices;
create trigger devices_own_host before update on public.devices
  for each row execute function private.devices_own_host();

-- ─── cloud_workers: revocation and a signing key ────────────────────────────
alter table public.cloud_workers add column if not exists revoked_at timestamptz;
-- Ed25519 public key (DER SPKI, base64) a paired worker claimed with. Null for a token-enrolled worker and a desktop.
alter table public.cloud_workers add column if not exists sign_key text
  check (sign_key is null or char_length(sign_key) <= 100);
grant select (revoked_at, sign_key) on public.cloud_workers to authenticated;

-- A revoked worker or Mac host stays revoked and stays as it was: a stolen session or a worker's key can't bring it
-- back, and a revoked Mac's heartbeat (desktop_worker_beat's upsert) fails here instead of reading online again.
-- Remove (delete) still works for a worker; a revoked Mac's row stays, and its device id can't beat again (below).
create or replace function private.cloud_workers_keep_revoked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null then
    raise exception 'This device was revoked.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists cloud_workers_keep_revoked on public.cloud_workers;
create trigger cloud_workers_keep_revoked before update on public.cloud_workers
  for each row execute function private.cloud_workers_keep_revoked();

-- A revoked Mac stays out: a heartbeat row (desktop_worker_beat's insert, which fires this before its upsert) is
-- refused for a device id whose key row or an earlier heartbeat row was revoked. Definer, to see the rows whoever
-- inserts. Whatever desktop_worker_beat becomes, its insert passes through here.
create or replace function private.cloud_workers_refuse_revoked_host()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'desktop' and new.device is not null and (
    exists (select 1 from public.devices d
             where d.kind = 'desktop' and d.user_id = new.owner_user and d.host_device = new.device and d.revoked_at is not null)
    or exists (select 1 from public.cloud_workers w
                where w.kind = 'desktop' and w.owner_user = new.owner_user and w.device = new.device and w.revoked_at is not null)
  ) then
    raise exception 'This device was revoked.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.cloud_workers_refuse_revoked_host() from public, anon, authenticated;

drop trigger if exists cloud_workers_refuse_revoked_host on public.cloud_workers;
create trigger cloud_workers_refuse_revoked_host before insert on public.cloud_workers
  for each row execute function private.cloud_workers_refuse_revoked_host();

-- Remove keeps working for a worker (revoked or not) and a live Mac, but a revoked Mac's heartbeat row stays, so it
-- can't be deleted to make room for a fresh one.
drop policy if exists "cloud_workers: delete own" on public.cloud_workers;
create policy "cloud_workers: delete own" on public.cloud_workers
  for delete to authenticated
  using ((select auth.uid()) = owner_user and (revoked_at is null or kind = 'headless'));

-- ─── phone_pairings: a pairing may be for a worker ──────────────────────────
alter table public.phone_pairings
  add column if not exists purpose text not null default 'device' check (purpose in ('device', 'worker')),
  add column if not exists arch text check (char_length(arch) <= 20),
  add column if not exists key_hash text check (key_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists worker_id uuid references public.cloud_workers (id) on delete set null;

alter table public.phone_pairings drop constraint if exists phone_pairings_kind_check;
alter table public.phone_pairings add constraint phone_pairings_kind_check
  check (kind in ('phone', 'browser', 'worker'));
alter table public.phone_pairings drop constraint if exists phone_pairings_platform_check;
alter table public.phone_pairings add constraint phone_pairings_platform_check
  check (platform in ('ios', 'android', 'web', 'darwin', 'linux', 'win32'));
-- A device pairing is never claimed as a worker and a worker pairing only as one, whoever writes the row; only a
-- worker claim carries a key hash or an arch.
-- Its own name: phone_pairings_purpose_check is the column's own check (purpose in ('device', 'worker')).
alter table public.phone_pairings drop constraint if exists phone_pairings_purpose_kind_check;
alter table public.phone_pairings add constraint phone_pairings_purpose_kind_check check (
  case purpose
    when 'worker' then kind is null or kind = 'worker'
    else (kind is null or kind <> 'worker') and key_hash is null and arch is null and worker_id is null
  end
);
-- purpose, arch, key_hash and worker_id are only written by the functions below: no insert or update grant.
grant select (purpose, arch, key_hash, worker_id) on public.phone_pairings to authenticated;

-- ─── The registry ────────────────────────────────────────────────────────────
-- security_invoker: the caller's RLS and column grants apply to every table read here (devices: your own and the
-- ones a vault you're in was granted to; cloud_workers: your workspaces'; phone_pairings: your own). key_hash and
-- wrapped keys are never selected.
create or replace view public.device_registry
with (security_invoker = true) as
  -- Macs, phones and browsers with a key, a Mac joined to its host row.
  select d.id,
         case d.kind when 'desktop' then 'mac' else d.kind end as kind,
         d.name,
         d.platform,
         d.user_id as owner_user,
         coalesce(w.org_id, p.org_id) as org_id,
         d.public_key as box_key,
         d.sign_key,
         d.passkey_id,
         d.passkey_key,
         d.fingerprint,
         coalesce(w.device, d.host_device) as host,
         d.id as key_device,
         w.id as worker_id,
         w.status,
         greatest(d.last_seen_at, w.last_seen_at) as last_seen_at,
         coalesce(d.revoked_at, w.revoked_at) as revoked_at,
         d.created_at
    from public.devices d
    left join lateral (
      select cw.id, cw.org_id, cw.device, cw.status, cw.last_seen_at, cw.revoked_at
        from public.cloud_workers cw
       where d.kind = 'desktop' and cw.kind = 'desktop' and cw.owner_user = d.user_id and cw.device = d.host_device
       order by cw.last_seen_at desc nulls last
       limit 1
    ) w on true
    left join lateral (
      select pp.org_id
        from public.phone_pairings pp
       where pp.device_id = d.id and pp.status = 'paired'
       order by pp.created_at desc
       limit 1
    ) p on true
   where d.user_id is not null
  union all
  -- Weft Workers, and Macs whose heartbeat row has no key row beside it (yet).
  select cw.id,
         case cw.kind when 'desktop' then 'mac' else 'worker' end,
         cw.name,
         cw.platform,
         cw.owner_user,
         cw.org_id,
         cw.public_key,
         cw.sign_key,
         null::text,
         null::text,
         null::text,
         case cw.kind when 'desktop' then cw.device else 'worker:' || cw.id::text end,
         null::uuid,
         cw.id,
         cw.status,
         cw.last_seen_at,
         cw.revoked_at,
         cw.created_at
    from public.cloud_workers cw
   where cw.kind = 'headless'
      or not exists (
        select 1 from public.devices d
         where d.kind = 'desktop' and d.user_id = cw.owner_user and d.host_device = cw.device
      );

-- Supabase's default privileges hand a new relation to anon and authenticated; take that back and allow reads only.
revoke all on public.device_registry from public, anon, authenticated;
grant select on public.device_registry to authenticated;

-- ─── One revocation ──────────────────────────────────────────────────────────
-- Revokes one of the caller's devices by its registry id, whatever its kind, and returns the kind:
-- - a key device (Mac, phone, browser): revoked_at set, its workspace-key grants dropped; a Mac's host row too.
-- - a worker: revoked_at set and its key_hash replaced, so its key stops working everywhere at once.
-- - a Mac's host row: revoked_at set, and the Mac's key row too.
-- Only the owner: an org admin's existing vault revoke (the "devices: admin revoke" policy) is unchanged. A phone or
-- browser is also pinned on the Mac that paired it; that Mac unpins and rotates the workspace key itself
-- (electron/pairing.cjs revoke), which this can't do from the server.
create or replace function public.device_revoke(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  d public.devices;
  w public.cloud_workers;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into d from public.devices where id = p_id and user_id = uid;
  if d.id is not null then
    update public.devices set revoked_at = now() where id = d.id and revoked_at is null;
    delete from public.workspace_key_grants where device_id = d.id;
    if d.kind = 'desktop' and d.host_device is not null then
      update public.cloud_workers set revoked_at = now(), status = 'offline'
        where kind = 'desktop' and owner_user = uid and device = d.host_device and revoked_at is null;
    end if;
    return case d.kind when 'desktop' then 'mac' else d.kind end;
  end if;
  select * into w from public.cloud_workers where id = p_id and owner_user = uid;
  if w.id is null then
    raise exception 'That isn''t one of your devices.' using errcode = '42501';
  end if;
  if w.kind = 'headless' then
    update public.cloud_workers
       set revoked_at = now(), status = 'offline', key_hash = 'revoked:' || gen_random_uuid()::text
     where id = w.id and revoked_at is null;
    return 'worker';
  end if;
  update public.cloud_workers set revoked_at = now(), status = 'offline' where id = w.id and revoked_at is null;
  update public.devices set revoked_at = now()
    where kind = 'desktop' and user_id = uid and host_device = w.device and revoked_at is null;
  delete from public.workspace_key_grants g
    using public.devices dd
    where g.device_id = dd.id and dd.kind = 'desktop' and dd.user_id = uid and dd.host_device = w.device;
  return 'mac';
end;
$$;

revoke all on function public.device_revoke(uuid) from public, anon;
grant execute on function public.device_revoke(uuid) to authenticated;

-- ─── Enrolling a worker by pairing ───────────────────────────────────────────
-- The Mac opens a worker pairing for a workspace it's in. An hour, like an enrolment token: the box clones and
-- installs before it claims. The secret stays in Electron main's memory and the install line, never here.
create or replace function public.worker_pair_open(p_org uuid, p_mac_device text, p_mac_key text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  pid uuid;
begin
  if uid is null or not private.is_org_member(p_org) then
    raise exception 'not a member of that workspace' using errcode = '42501';
  end if;
  insert into public.phone_pairings (user_id, org_id, mac_device, mac_key, purpose, expires_at)
    values (uid, p_org, p_mac_device, p_mac_key, 'worker', now() + interval '1 hour')
    returning id into pid;
  return pid;
end;
$$;

revoke all on function public.worker_pair_open(uuid, text, text) from public, anon;
grant execute on function public.worker_pair_open(uuid, text, text) to authenticated;

-- The box's claim. It has no session, so this is anon; the pairing id it names is only in the install line, and the
-- Mac trusts nothing here until the proof (made with the code's secret) and the signature check out. One claim per
-- code: a second finds it no longer open.
create or replace function public.worker_pair_claim(
  p_pairing uuid, p_name text, p_platform text, p_arch text,
  p_box_key text, p_sign_key text, p_key_hash text, p_proof text, p_sig text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_platform not in ('darwin', 'linux', 'win32') then
    raise exception 'a worker runs on darwin, linux or win32';
  end if;
  update public.phone_pairings
     set status = 'claimed', kind = 'worker', name = p_name, platform = p_platform, arch = coalesce(p_arch, ''),
         box_key = p_box_key, sign_key = p_sign_key, key_hash = p_key_hash, proof = p_proof, sig = p_sig
   where id = p_pairing and purpose = 'worker' and status = 'open' and expires_at > now();
  return found;
end;
$$;

revoke all on function public.worker_pair_claim(uuid, text, text, text, text, text, text, text, text) from public;
grant execute on function public.worker_pair_claim(uuid, text, text, text, text, text, text, text, text) to anon, authenticated;

-- The Mac's confirm, after it checked the claim and the user gave Touch ID. It passes back the keys it checked, so a
-- row changed since then doesn't match; the worker gets the same row worker_enrol makes, plus its sign key.
create or replace function public.worker_pair_confirm(p_pairing uuid, p_key_hash text, p_box_key text, p_sign_key text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  p public.phone_pairings;
  wid uuid;
begin
  select * into p from public.phone_pairings
    where id = p_pairing and user_id = uid and purpose = 'worker' for update;
  if p.id is null or p.status <> 'claimed' or p.expires_at < now() - interval '10 minutes' then
    raise exception 'that pairing is unknown, unclaimed or expired' using errcode = '28000';
  end if;
  if p.key_hash is distinct from p_key_hash or p.box_key is distinct from p_box_key or p.sign_key is distinct from p_sign_key then
    raise exception 'the claim changed after it was checked' using errcode = '28000';
  end if;
  if not private.is_org_member(p.org_id) then
    raise exception 'not a member of that workspace' using errcode = '42501';
  end if;
  insert into public.cloud_workers (org_id, owner_user, name, platform, arch, key_hash, public_key, sign_key, status, last_seen_at)
    values (p.org_id, uid, p.name, p.platform, coalesce(p.arch, ''), p.key_hash, p.box_key, p.sign_key, 'online', now())
    returning id into wid;
  -- The hash is the worker's row's own now, which no client may read (the wake and presence topics derive from it):
  -- it leaves the pairing row, and worker_pair_status checks the worker's row instead.
  update public.phone_pairings set status = 'paired', worker_id = wid, key_hash = null where id = p.id;
  return wid;
end;
$$;

revoke all on function public.worker_pair_confirm(uuid, text, text, text) from public, anon;
grant execute on function public.worker_pair_confirm(uuid, text, text, text) to authenticated;

-- The box asks how its claim went, with the key whose hash it claimed (once paired, the hash on its worker's row): only
-- that box can read the answer. Paired, it gets what worker_enrol returns, minus the key it already holds.
create or replace function public.worker_pair_status(p_pairing uuid, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.phone_pairings;
begin
  select pp.* into p from public.phone_pairings pp
    where pp.id = p_pairing and pp.purpose = 'worker'
      and (pp.key_hash = private.sha256_hex(coalesce(p_key, ''))
        or exists (select 1 from public.cloud_workers w
                    where w.id = pp.worker_id and w.key_hash = private.sha256_hex(coalesce(p_key, ''))));
  if p.id is null then
    raise exception 'unknown worker pairing' using errcode = '28000';
  end if;
  if p.status = 'paired' and p.worker_id is not null then
    return jsonb_build_object('status', 'paired', 'worker_id', p.worker_id, 'org_id', p.org_id, 'owner_user', p.user_id,
      'device', 'worker:' || p.worker_id::text);
  end if;
  return jsonb_build_object('status', case when p.status = 'claimed' and p.expires_at < now() - interval '10 minutes' then 'cancelled' else p.status end);
end;
$$;

revoke all on function public.worker_pair_status(uuid, text) from public;
grant execute on function public.worker_pair_status(uuid, text) to anon, authenticated;
