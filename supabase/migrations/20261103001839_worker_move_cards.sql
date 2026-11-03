-- Re-pairing a Weft Worker keeps its threads (docs/architecture/weft-worker.md#re-pairing-and-a-lost-mac,
-- docs/architecture/device-registry.md#moving-a-workers-threads).
--
-- Every worker thread is filed by cloud_cards.owner_worker, and worker_put_card refuses a card another worker id owns.
-- A re-pair (weft-worker enrol --re-pair, or a wipe and a fresh enrol) makes a new cloud_workers row, so before this
-- every thread stayed under the old id, drawn under an offline worker, and the box could never publish them again.
--
-- 1. private.move_worker_cards(from, to): re-points the cards and drops the old id's project snapshots (the box
--    publishes them again under its new id). No checks: only the two functions below call it.
-- 2. worker_move_cards(from, to): Settings → Devices → Move threads to…, for the owner of both workers, in one
--    workspace, onto a worker that isn't revoked.
-- 3. worker_pair_confirm moves them itself when the box proves it's the same box: its claim carries the same Ed25519
--    sign key as the old row (sign-key.json survives a re-pair and the documented wipe), and the Mac checked the
--    claim's signature with that key before it confirmed (electron/host-pairing.cjs), so the box holds the private
--    half. A name proves nothing and isn't used. Same owner and workspace only; the old row isn't revoked here.
-- 4. worker_thread_counts(): how many threads each of your workers owns, for Settings → Devices.
--
-- What stays with the old id: connector grants, pins, mints and live tokens (a capability or its audit; a new worker
-- earns its own), tunnels and webhook relays (they point at the old box's dev server and carry its sealed secret),
-- device_calls and cloud_worker_lists (that box's own reports), and pairings and enrolments (history).
-- cloud_thread_items are keyed by card id and need nothing.

create or replace function private.move_worker_cards(p_from uuid, p_to uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.cloud_cards
     set owner_worker = p_to, owner_device = 'worker:' || p_to::text
   where owner_worker = p_from;
  get diagnostics moved = row_count;
  delete from public.cloud_worker_projects where worker_id = p_from;
  return moved;
end;
$$;

revoke all on function private.move_worker_cards(uuid, uuid) from public, anon, authenticated;

create or replace function public.worker_move_cards(p_from uuid, p_to uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  f public.cloud_workers;
  t public.cloud_workers;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into f from public.cloud_workers where id = p_from and owner_user = uid and kind = 'headless';
  select * into t from public.cloud_workers where id = p_to and owner_user = uid and kind = 'headless';
  if f.id is null or t.id is null then
    raise exception 'Both must be workers of yours.' using errcode = '42501';
  end if;
  if f.id = t.id then
    raise exception 'Pick another worker.' using errcode = '22023';
  end if;
  if f.org_id is distinct from t.org_id then
    raise exception 'Both workers must be in the same workspace.' using errcode = '42501';
  end if;
  if t.revoked_at is not null then
    raise exception 'That worker was revoked.' using errcode = '42501';
  end if;
  return private.move_worker_cards(f.id, t.id);
end;
$$;

revoke all on function public.worker_move_cards(uuid, uuid) from public, anon;
grant execute on function public.worker_move_cards(uuid, uuid) to authenticated;

create or replace function public.worker_pair_confirm(p_pairing uuid, p_key_hash text, p_box_key text, p_sign_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  p public.phone_pairings;
  wid uuid;
  prior uuid;
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
  -- The same box enrolled again: its threads come along (the header above says why the sign key proves it).
  for prior in
    select id from public.cloud_workers
     where sign_key = p.sign_key and owner_user = uid and org_id = p.org_id and kind = 'headless' and id <> wid
  loop
    perform private.move_worker_cards(prior, wid);
  end loop;
  -- The hash is the worker's row's own now, which no client may read (the wake and presence topics derive from it):
  -- it leaves the pairing row, and worker_pair_status checks the worker's row instead.
  update public.phone_pairings set status = 'paired', worker_id = wid, key_hash = null where id = p.id;
  return wid;
end;
$$;

-- Yours only, as the caller: RLS on both tables decides. The copilot and deleted cards aren't threads.
create or replace function public.worker_thread_counts()
returns table (worker_id uuid, threads bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.owner_worker, count(*)
    from public.cloud_cards c
    join public.cloud_workers w on w.id = c.owner_worker and w.owner_user = (select auth.uid())
   where not c.deleted and coalesce(c.card->>'role', '') <> 'copilot'
   group by c.owner_worker;
$$;

revoke all on function public.worker_thread_counts() from public, anon;
grant execute on function public.worker_thread_counts() to authenticated;
