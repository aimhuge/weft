-- Phone pairing, the workspace sync key and its grants (docs/architecture/mobile-security.md).
-- The Mac pins paired devices itself; these tables carry the claim and the sealed keys, never a secret.

-- ── devices: phones and browsers beside Macs ────────────────────────────────
alter table public.devices drop constraint if exists devices_platform_check;
alter table public.devices add constraint devices_platform_check
  check (platform in ('darwin', 'linux', 'win32', 'ios', 'android', 'web'));
alter table public.devices add column if not exists kind text not null default 'desktop'
  check (kind in ('desktop', 'phone', 'browser'));
-- Ed25519 public key (base64) a phone signs approvals with; null for desktops and browsers.
alter table public.devices add column if not exists sign_key text;

-- A revoked device stays revoked: a stolen session can't clear revoked_at again.
create or replace function private.devices_keep_revoked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked device stays revoked.';
  end if;
  return new;
end;
$$;

drop trigger if exists devices_keep_revoked on public.devices;
create trigger devices_keep_revoked before update on public.devices
  for each row execute function private.devices_keep_revoked();

-- The Mac adds a phone's row as the same account; RLS still requires user_id = auth.uid().
alter table public.devices alter column user_id set default auth.uid();
grant insert (user_id, name, public_key, fingerprint, platform, kind, sign_key) on public.devices to authenticated;
grant update (revoked_at) on public.devices to authenticated;
grant select (kind, sign_key) on public.devices to authenticated;

-- ── phone_pairings: one QR code's life ──────────────────────────────────────
create table public.phone_pairings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  org_id       uuid not null references public.orgs (id) on delete cascade,
  -- The Mac showing the code: its lib/device-id.ts id and its X25519 public key.
  mac_device   text not null,
  mac_key      text not null,
  status       text not null default 'open' check (status in ('open', 'claimed', 'paired', 'cancelled')),
  expires_at   timestamptz not null default now() + interval '5 minutes',
  -- The claim the phone (or browser) writes; the Mac checks proof and sig before trusting any of it.
  name         text check (char_length(name) <= 80),
  platform     text check (platform in ('ios', 'android', 'web', 'darwin')),
  kind         text check (kind in ('phone', 'browser')),
  box_key      text check (char_length(box_key) <= 100),
  sign_key     text check (char_length(sign_key) <= 100),
  proof        text check (char_length(proof) <= 100),
  sig          text check (char_length(sig) <= 200),
  device_id    uuid references public.devices (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index phone_pairings_user_idx on public.phone_pairings (user_id, created_at desc);

create trigger phone_pairings_touch before update on public.phone_pairings
  for each row execute function private.touch_updated_at();

alter table public.phone_pairings enable row level security;

create policy "phone_pairings: read own" on public.phone_pairings
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "phone_pairings: open own" on public.phone_pairings
  for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'open' and private.is_org_member(org_id));

-- A claim lands only while the code is open and fresh; the Mac's own updates (paired, cancelled) follow.
create policy "phone_pairings: update own" on public.phone_pairings
  for update to authenticated
  using ((select auth.uid()) = user_id and status in ('open', 'claimed') and expires_at > now() - interval '10 minutes')
  with check ((select auth.uid()) = user_id);

revoke all on public.phone_pairings from anon, authenticated;
grant select, delete on public.phone_pairings to authenticated;
grant insert (org_id, mac_device, mac_key) on public.phone_pairings to authenticated;
grant update (status, name, platform, kind, box_key, sign_key, proof, sig, device_id) on public.phone_pairings to authenticated;

create policy "phone_pairings: delete own" on public.phone_pairings
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Whether the caller owns a public.devices row (private.owns_device is about cloud_cards' text ids).
create or replace function private.owns_key_device(p_device uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.devices d where d.id = p_device and d.user_id = (select auth.uid()));
$$;

-- ── the workspace sync key, one row per version ─────────────────────────────
create table public.workspace_keys (
  org_id      uuid not null references public.orgs (id) on delete cascade,
  version     integer not null check (version >= 1),
  created_by  uuid not null default auth.uid() references auth.users (id),
  created_at  timestamptz not null default now(),
  primary key (org_id, version)
);

alter table public.workspace_keys enable row level security;

create policy "workspace_keys: members read" on public.workspace_keys
  for select to authenticated using (private.is_org_member(org_id));

create policy "workspace_keys: members add" on public.workspace_keys
  for insert to authenticated
  with check (private.is_org_member(org_id) and (select auth.uid()) = created_by);

revoke all on public.workspace_keys from anon, authenticated;
grant select on public.workspace_keys to authenticated;
grant insert (org_id, version) on public.workspace_keys to authenticated;

-- ── the key, sealed to one device ───────────────────────────────────────────
create table public.workspace_key_grants (
  org_id       uuid not null,
  version      integer not null,
  device_id    uuid not null references public.devices (id) on delete cascade,
  wrapped_key  text not null check (char_length(wrapped_key) <= 200),
  granted_by   uuid not null default auth.uid() references auth.users (id),
  granted_at   timestamptz not null default now(),
  primary key (org_id, version, device_id),
  foreign key (org_id, version) references public.workspace_keys (org_id, version) on delete cascade
);

create index workspace_key_grants_device_idx on public.workspace_key_grants (device_id);

alter table public.workspace_key_grants enable row level security;

-- A device's owner reads its grants; the granter reads what it granted (to list and revoke).
create policy "workspace_key_grants: read own" on public.workspace_key_grants
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and ((select auth.uid()) = granted_by or private.owns_key_device(device_id))
  );

create policy "workspace_key_grants: members grant" on public.workspace_key_grants
  for insert to authenticated
  with check (private.is_org_member(org_id) and (select auth.uid()) = granted_by);

create policy "workspace_key_grants: revoke" on public.workspace_key_grants
  for delete to authenticated
  using ((select auth.uid()) = granted_by or private.owns_key_device(device_id));

revoke all on public.workspace_key_grants from anon, authenticated;
grant select, delete on public.workspace_key_grants to authenticated;
grant insert (org_id, version, device_id, wrapped_key) on public.workspace_key_grants to authenticated;

alter publication supabase_realtime add table public.phone_pairings;
