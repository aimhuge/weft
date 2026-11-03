-- The workspace sync key, granted to a Weft Worker (docs/architecture/mobile-security.md#sealing-on-a-weft-worker).
-- A worker has no public.devices row, so workspace_key_grants can't hold its copy. Here each version of the key is
-- sealed to the worker's box key, the one the granting Mac pinned under Touch ID (electron/worker-pins.cjs), and signed
-- by that Mac's approval key (electron/desktop-signer.cjs). The worker reads its rows through worker_key_grants(p_key)
-- and takes one only when the signature checks against the Mac key it pinned at pairing (lib/worker-mac-keys.ts), the
-- box key it names is its own, and it opens under its purpose (lib/worker-key-grant.ts).
--
-- Neither the server nor a stolen session can read a grant (a box sealed to a key only the worker holds) or plant one
-- (no Mac signature). They can delete rows and stall the ping: denial of service only. Additive: a new table, a lookup,
-- two triggers. cloud_commands and its policies are untouched.

create table if not exists public.worker_key_grants (
  org_id     uuid not null references public.orgs (id) on delete cascade,
  worker_id  uuid not null references public.cloud_workers (id) on delete cascade,
  version    integer not null check (version > 0),
  -- The worker's X25519 public key it was sealed to (base64 DER), as the Mac pinned it: the worker refuses another.
  box_key    text not null check (char_length(box_key) between 40 and 200),
  -- lib/worker-seal.ts's sealed JSON ({ v, epk, iv, ct, tag }) of the key's base64 bytes.
  sealed     text not null check (char_length(sealed) <= 1000),
  -- The granting Mac's device id (lib/device-id.ts), for the Devices list; the signature is the check.
  mac_device text not null check (char_length(mac_device) <= 100),
  -- Ed25519 over "weft-worker-key-v1\n<org>\n<worker>\n<version>\n<box key>\n<sha256(sealed) hex>", base64.
  sig        text not null check (char_length(sig) <= 200),
  granted_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (worker_id, version),
  foreign key (org_id, version) references public.workspace_keys (org_id, version) on delete cascade
);

create index if not exists worker_key_grants_org_idx on public.worker_key_grants (org_id, version);

alter table public.worker_key_grants enable row level security;
revoke all on public.worker_key_grants from anon, authenticated;

-- The worker's owner, a member of its workspace, grants, reads and drops; nobody else sees the rows.
create policy "worker_key_grants: owner reads" on public.worker_key_grants
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and exists (select 1 from public.cloud_workers w where w.id = worker_id and w.owner_user = (select auth.uid()))
  );

create policy "worker_key_grants: owner grants" on public.worker_key_grants
  for insert to authenticated
  with check (
    (select auth.uid()) = granted_by
    and private.is_org_member(org_id)
    and exists (
      select 1 from public.cloud_workers w
      where w.id = worker_id and w.org_id = org_id and w.owner_user = (select auth.uid()) and w.revoked_at is null
    )
  );

create policy "worker_key_grants: owner drops" on public.worker_key_grants
  for delete to authenticated
  using (exists (select 1 from public.cloud_workers w where w.id = worker_id and w.owner_user = (select auth.uid())));

grant select, delete on public.worker_key_grants to authenticated;
grant insert (org_id, worker_id, version, box_key, sealed, mac_device, sig) on public.worker_key_grants to authenticated;

-- ─── The worker's lookup ─────────────────────────────────────────────────────
-- Its own rows in its own workspace, by its key; nothing for a revoked worker.
create or replace function public.worker_key_grants(p_key text)
returns table (org_id uuid, worker_id uuid, version integer, box_key text, sealed text, mac_device text, sig text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if w.revoked_at is not null then
    return;
  end if;
  return query
    select g.org_id, g.worker_id, g.version, g.box_key, g.sealed, g.mac_device, g.sig
      from public.worker_key_grants g
     where g.worker_id = w.id and g.org_id = w.org_id
     order by g.version;
end;
$$;

revoke all on function public.worker_key_grants(text) from public;
grant execute on function public.worker_key_grants(text) to anon, authenticated;

-- ─── A revoked worker's grants go with it ────────────────────────────────────
create or replace function private.worker_key_grants_drop_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    delete from public.worker_key_grants where worker_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.worker_key_grants_drop_revoked() from public, anon, authenticated;

drop trigger if exists cloud_workers_drop_key_grants on public.cloud_workers;
create trigger cloud_workers_drop_key_grants after update of revoked_at on public.cloud_workers
  for each row execute function private.worker_key_grants_drop_revoked();

-- ─── The key_grant ping ──────────────────────────────────────────────────────
-- A new grant pings the worker on its own topic, derived from key_hash like its wake topic
-- (20261030072445_worker_wake.sql), so it reads its grants at once instead of at its next refresh. Carries nothing.
create or replace function private.worker_key_grant_topic(p_key_hash text)
returns text
language sql
immutable
set search_path = ''
as $$ select 'worker-keys:' || private.sha256_hex('weft-worker-keys:' || p_key_hash); $$;
revoke all on function private.worker_key_grant_topic(text) from public, anon, authenticated;

create or replace function private.worker_key_grants_ping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hash text;
begin
  select w.key_hash into hash from public.cloud_workers w where w.id = NEW.worker_id;
  if hash is not null then
    perform realtime.send('{}'::jsonb, 'key_grant', private.worker_key_grant_topic(hash), false);
  end if;
  return NEW;
end;
$$;
revoke all on function private.worker_key_grants_ping() from public, anon, authenticated;

drop trigger if exists worker_key_grants_ping on public.worker_key_grants;
create trigger worker_key_grants_ping after insert on public.worker_key_grants
  for each row execute function private.worker_key_grants_ping();
