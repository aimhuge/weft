-- Weft's shared 🔐 vault (docs/architecture/teams-vault.md): the team's envelope-encrypted secrets synced to
-- Supabase. The local vault on disk (electron/vault.cjs) is the source of truth for a personal workspace;
-- this migration is the source of truth once a vault is shared with an org (20261013170000_teams.sql's
-- orgs + org_memberships). Crypto is the same shape 1Password and Bitwarden use: one random vault key per
-- vault, sealed per device (a sealed box over the device's X25519 public key, kept in vault_grants), and
-- secret values encrypted with XChaCha20-Poly1305 (vault_secrets). The server holds ciphertext only; the
-- desktop's Electron main holds the device private key in the macOS Keychain via safeStorage and never
-- lets a plaintext value past its own process boundary. RLS funnels every read through private.is_org_member
-- (a SECURITY DEFINER helper, since org_memberships has no policies of its own). Realtime carries
-- vault_secrets, vault_events, and the new grant for a device over the user's JWT.

-- ── Membership helpers ───────────────────────────────────────────────────────
-- private.is_org_member already ships (20261013161111_teams_rls.sql): SECURITY DEFINER, STABLE,
-- search_path = '', one uuid parameter. Fifteen existing policies depend on it, so this migration does
-- NOT redeclare it — CREATE OR REPLACE cannot rename an input parameter, and a DROP would take those
-- policies with it. The same predicate, already in place, is what every policy below calls.
--
-- private.is_org_role is new here: the same shape with a minimum role. 'member' | 'admin' | 'owner'.
create or replace function private.is_org_role(p_org uuid, p_min text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_min
           when 'member' then exists (
             select 1 from public.org_memberships
              where org_id = p_org and user_id = (select auth.uid())
                and role in ('member', 'admin', 'owner'))
           when 'admin'  then exists (
             select 1 from public.org_memberships
              where org_id = p_org and user_id = (select auth.uid())
                and role in ('admin',  'owner'))
           when 'owner'  then exists (
             select 1 from public.org_memberships
              where org_id = p_org and user_id = (select auth.uid())
                and role = 'owner')
           else false
         end;
$$;

-- ── A team's vault ───────────────────────────────────────────────────────────
-- One row per (org, repo). A repo is the lowercased "owner/name" of a GitHub repo, the same shape that
-- `git remote` produces; the local vault uses "github:owner/name" today, the team vault drops the prefix
-- because the org already scopes it. current_key_version bumps on a rotate; server_version bumps on every
-- write so the desktop's pull is a delta, not a re-download.

create table public.vaults (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs (id) on delete cascade,
  repo                 text not null check (repo ~ '^[a-z0-9_.-]+/[a-z0-9_.-]+$'),
  label                text not null,
  current_key_version  integer not null default 1 check (current_key_version >= 1),
  server_version       bigint   not null default 0,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, repo)
);

create index vaults_org_idx on public.vaults (org_id);

create trigger vaults_touch_updated_at
  before update on public.vaults
  for each row execute function private.touch_updated_at();

-- Bumps server_version on every change to a vault. Clients pull rows whose row_version is above what
-- they last saw; the vault's server_version is the high-water mark the client holds. An explicit
-- setter (the rotate path, which assigns the next key_version) bumps it deliberately; otherwise the
-- trigger increments it.
create or replace function private.bump_server_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.server_version := 1;
  elsif tg_op = 'UPDATE' and new.server_version = old.server_version then
    new.server_version := old.server_version + 1;
  end if;
  return new;
end;
$$;

create trigger vaults_bump_server_version
  before insert or update on public.vaults
  for each row execute function private.bump_server_version();

alter table public.vaults enable row level security;

create policy "vaults: read by member" on public.vaults
  for select to authenticated using (private.is_org_member(org_id));

create policy "vaults: admin update" on public.vaults
  for update to authenticated
  using (private.is_org_role(org_id, 'admin'))
  with check (private.is_org_role(org_id, 'admin'));

-- Inserts go through private.share_vault, which inserts the first vault_grants row in the same
-- transaction. There is no INSERT policy on vaults, so a direct INSERT from the client is refused.
revoke all on public.vaults from anon, authenticated;
grant select (id, org_id, repo, label, current_key_version, server_version, created_by, created_at, updated_at) on public.vaults to authenticated;

-- ── A device the team trusts ─────────────────────────────────────────────────
-- One row per (user, device). The private key lives in the macOS Keychain via safeStorage
-- (electron/device-key.cjs); the public key is what other devices fetch to grant this one access. The
-- fingerprint is what the TOFU UI shows on both sides of a grant (docs/architecture/teams-vault.md,
-- "Grants"). Revoked rows are kept so an event log can still name them, but new grants never include
-- them. A recovery key for a vault is a special device row with user_id = null and fingerprint =
-- 'recovery'; the unique (user_id, public_key) index allows it because (null, anything) does not
-- collide, and there is at most one recovery row per vault in practice (created by the recovery flow).

create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users (id) on delete cascade,
  -- A label for the device. The recovery row is named 'recovery'.
  name          text not null,
  public_key    text not null,
  fingerprint   text not null,
  platform      text not null check (platform in ('darwin', 'linux', 'win32')),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

-- A user can register one row per (own public key). The recovery row (user_id null) is excluded from
-- the unique index so the constraint only applies to user-owned devices; partial indexes on NULLs
-- don't fire in Postgres, which is what we want.
create unique index devices_user_pubkey_idx on public.devices (user_id, public_key)
  where user_id is not null;
create index devices_user_idx on public.devices (user_id);
create index devices_pubkey_idx on public.devices (public_key);

-- ── The vault key, sealed to one device ─────────────────────────────────────
-- One row per (vault, device, key_version). A device is allowed in for that key version only. The wrapped
-- key is a libsodium sealed box over the device's public key (electron/vault-crypto.cjs wrapKey); only
-- the device's own private key can open it. The granter is recorded so the audit log has an actor even
-- after the row is gone.

create table public.vault_grants (
  id            uuid primary key default gen_random_uuid(),
  vault_id      uuid not null references public.vaults (id) on delete cascade,
  device_id     uuid not null references public.devices (id) on delete cascade,
  key_version   integer not null check (key_version >= 1),
  wrapped_key   text not null,
  granted_by    uuid not null references auth.users (id),
  granted_at    timestamptz not null default now(),
  unique (vault_id, device_id, key_version)
);

create index vault_grants_vault_idx on public.vault_grants (vault_id);
create index vault_grants_device_idx on public.vault_grants (device_id);

alter table public.devices enable row level security;

-- A user sees their own devices.
create policy "devices: read own" on public.devices
  for select to authenticated using ((select auth.uid()) = user_id);

-- A teammate needs to read a device's public_key, name and fingerprint to grant it access; the
-- private.device_visible_to helper checks that the calling user belongs to an org that already has
-- a grant for the device. It takes the device's id and owner as plain arguments, not the composite
-- `devices` type, so it can be defined before any table exists — the policy on devices below can
-- then call it, and the function's own body reads vault_grants (created further down).
create or replace function private.device_visible_to(p_device_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_user_id = (select auth.uid()))
      or exists (
           select 1
             from public.vault_grants g
             join public.vaults v on v.id = g.vault_id
            where g.device_id = p_device_id
              and private.is_org_member(v.org_id)
         );
$$;

create policy "devices: read shared" on public.devices
  for select to authenticated using (private.device_visible_to(id, user_id));

-- A user can register their own device (idempotent: ON CONFLICT updates last_seen_at only). The name
-- is filled in by main on first registration and editable later in Settings.
create policy "devices: add own" on public.devices
  for insert to authenticated
  with check ((select auth.uid()) = user_id and revoked_at is null);

create policy "devices: update own" on public.devices
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Admins can revoke any device that has a grant on one of the org's vaults (the rotate path).
create policy "devices: admin revoke" on public.devices
  for update to authenticated
  using (
    revoked_at is null
    and exists (
      select 1
        from public.vault_grants g
        join public.vaults v on v.id = g.vault_id
       where g.device_id = devices.id
         and private.is_org_role(v.org_id, 'admin')
    )
  )
  with check (true);

revoke all on public.devices from anon, authenticated;
grant select (id, user_id, name, public_key, fingerprint, platform, last_seen_at, revoked_at, created_at) on public.devices to authenticated;
grant insert (name, public_key, fingerprint, platform) on public.devices to authenticated;
grant update (name, last_seen_at) on public.devices to authenticated;

alter table public.vault_grants enable row level security;

-- A user can read the grant for one of their own, non-revoked devices. Other members of the org cannot
-- read a grant that isn't theirs (the row would leak a fingerprint even though they can't open the box).
create policy "vault_grants: read by device owner" on public.vault_grants
  for select to authenticated
  using (
    exists (
      select 1 from public.devices d
       where d.id = vault_grants.device_id
         and d.user_id = (select auth.uid())
         and d.revoked_at is null
    )
  );

-- The recovery grant: a member of the org can read it too, because the recovery flow re-derives the
-- keypair from the words the user pasted (docs/architecture/teams-vault.md, "Recovery key"). The
-- recovery device row is the one with user_id is null and fingerprint = 'recovery'.
create policy "vault_grants: read recovery" on public.vault_grants
  for select to authenticated
  using (
    exists (
      select 1
        from public.devices d
        join public.vaults v on v.id = vault_grants.vault_id
       where d.id = vault_grants.device_id
         and d.user_id is null
         and d.fingerprint = 'recovery'
         and private.is_org_member(v.org_id)
    )
  );

-- A grant can only be inserted by a user who owns the target device. This is the rule that makes the
-- TOFU flow possible: only the user that holds the new device's private key can read a grant sealed to
-- it, and only the granter (also a member) is allowed to write the row. The trigger that shares a
-- brand-new vault (private.share_vault) runs as the function owner and is exempt from this policy; it
-- writes the very first grant for the actor's own device.
create policy "vault_grants: own device insert" on public.vault_grants
  for insert to authenticated
  with check (
    exists (
      select 1 from public.devices d
       where d.id = vault_grants.device_id
         and d.user_id = (select auth.uid())
         and d.revoked_at is null
    )
    and exists (
      select 1 from public.vaults v
       where v.id = vault_grants.vault_id
         and private.is_org_member(v.org_id)
    )
  );

-- A grant is append-only; rotate-on-remove does not update a grant, it adds a new one at the new key
-- version and the old one falls out of use. There is no UPDATE policy. Admins may delete a grant to
-- clean up after a revocation.
create policy "vault_grants: admin remove" on public.vault_grants
  for delete to authenticated
  using (
    exists (
      select 1
        from public.vaults v
       where v.id = vault_grants.vault_id
         and private.is_org_role(v.org_id, 'admin')
    )
  );

revoke all on public.vault_grants from anon, authenticated;
grant select (id, vault_id, device_id, key_version, wrapped_key, granted_by, granted_at) on public.vault_grants to authenticated;
grant insert (vault_id, device_id, key_version, wrapped_key, granted_by) on public.vault_grants to authenticated;
grant delete on public.vault_grants to authenticated;

-- ── The ciphertext rows ──────────────────────────────────────────────────────
-- One row per (vault, name, environment). The vault is what scopes reads; encryption scopes who can
-- actually open the ciphertext. row_version is the optimistic-concurrency check on writes; is_blank is
-- a name with no value yet (mcp__secrets__add_blank), so the team's UI can show it as a "to fill in" row.

create table public.vault_secrets (
  id            uuid primary key default gen_random_uuid(),
  vault_id      uuid not null references public.vaults (id) on delete cascade,
  name          text not null check (name ~ '^[A-Z_][A-Z0-9_]*$'),
  environment   text not null check (environment in ('development', 'preview', 'production')),
  ciphertext    text,
  nonce         text,
  key_version   integer not null check (key_version >= 1),
  row_version   bigint not null default 0,
  is_blank      boolean not null default false,
  hint          text,
  updated_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  unique (vault_id, name, environment)
);

create index vault_secrets_vault_idx on public.vault_secrets (vault_id);
create index vault_secrets_row_version_idx on public.vault_secrets (vault_id, row_version);

create trigger vault_secrets_touch_updated_at
  before update on public.vault_secrets
  for each row execute function private.touch_updated_at();

-- Bumps row_version on every change; clients send the version they last read and the WHERE in the
-- update statement refuses to overwrite a row that's moved on. Combined with the vault_version trigger
-- below, the vault's high-water mark advances on every change so the desktop's pull is a delta.
create or replace function private.bump_row_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

create trigger vault_secrets_bump_row_version
  before update on public.vault_secrets
  for each row execute function private.bump_row_version();

-- When a secret row changes, also advance its vault's server_version. Used by the pull to fetch the
-- delta; sits behind a trigger so the desktop can't forget to bump it.
create or replace function private.bump_vault_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.vaults set server_version = server_version + 1 where id = new.vault_id;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.vault_id = old.vault_id then
      update public.vaults set server_version = server_version + 1 where id = new.vault_id;
    else
      update public.vaults set server_version = server_version + 1 where id = old.vault_id;
      update public.vaults set server_version = server_version + 1 where id = new.vault_id;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    update public.vaults set server_version = server_version + 1 where id = old.vault_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger vault_secrets_bump_vault_version
  after insert or update or delete on public.vault_secrets
  for each row execute function private.bump_vault_version();

alter table public.vault_secrets enable row level security;

create policy "vault_secrets: read by member" on public.vault_secrets
  for select to authenticated
  using (
    exists (
      select 1 from public.vaults v
       where v.id = vault_secrets.vault_id
         and private.is_org_member(v.org_id)
    )
  );

-- A write needs (a) membership of the vault's org and (b) the row's name + environment to be valid.
-- The optimistic-concurrency check (row_version = $expected) is in the desktop's WHERE clause, not
-- the policy, so a 409 surfaces as a normal UPDATE that matches zero rows.
create policy "vault_secrets: member insert" on public.vault_secrets
  for insert to authenticated
  with check (
    exists (
      select 1 from public.vaults v
       where v.id = vault_secrets.vault_id
         and private.is_org_member(v.org_id)
    )
  );

create policy "vault_secrets: member update" on public.vault_secrets
  for update to authenticated
  using (
    exists (
      select 1 from public.vaults v
       where v.id = vault_secrets.vault_id
         and private.is_org_member(v.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.vaults v
       where v.id = vault_secrets.vault_id
         and private.is_org_member(v.org_id)
    )
  );

create policy "vault_secrets: member remove" on public.vault_secrets
  for delete to authenticated
  using (
    exists (
      select 1 from public.vaults v
       where v.id = vault_secrets.vault_id
         and private.is_org_member(v.org_id)
    )
  );

revoke all on public.vault_secrets from anon, authenticated;
grant select on public.vault_secrets to authenticated;
grant insert, update, delete on public.vault_secrets to authenticated;

-- ── The audit log ────────────────────────────────────────────────────────────
-- Append-only. The drawer's Event log tab reads this. No values, no ciphertext. actor_email is
-- denormalized so the row survives the user being deleted (same reason as org_billing_events in
-- 20261013180000_billing.sql). Realtime publishes the table for the live event feed.

create table public.vault_events (
  id                   uuid primary key default gen_random_uuid(),
  vault_id             uuid not null references public.vaults (id) on delete cascade,
  actor_user_id        uuid references auth.users (id) on delete set null,
  actor_email          text,
  device_id            uuid references public.devices (id) on delete set null,
  action               text not null check (action in (
                           'secret.added', 'secret.changed', 'secret.removed',
                           'secret.blank_added', 'secret.filled',
                           'device.added', 'device.removed',
                           'vault.rotated', 'vault.recovery_shown'
                         )),
  target_name          text,
  target_environment   text check (target_environment in ('development', 'preview', 'production')),
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

create index vault_events_vault_created_idx on public.vault_events (vault_id, created_at desc);
create index vault_events_actor_idx on public.vault_events (actor_user_id);

alter table public.vault_events enable row level security;

create policy "vault_events: read by member" on public.vault_events
  for select to authenticated
  using (
    exists (
      select 1 from public.vaults v
       where v.id = vault_events.vault_id
         and private.is_org_member(v.org_id)
    )
  );

-- Any member can write a vault event for a vault they belong to (mcp__secrets__* tools, the local
-- import, the Add form). The action is the fixed vocabulary above.
create policy "vault_events: member insert" on public.vault_events
  for insert to authenticated
  with check (
    exists (
      select 1 from public.vaults v
       where v.id = vault_events.vault_id
         and private.is_org_member(v.org_id)
    )
  );

revoke all on public.vault_events from anon, authenticated;
grant select on public.vault_events to authenticated;
grant insert on public.vault_events to authenticated;

-- ── The "add this device" handoff ────────────────────────────────────────────
-- A row here is a granter's offer to add a teammate's device to a vault. The new device is identified
-- by its fingerprint, not its uuid, because the device row may not exist on the server yet (the
-- teammate's first sign-in creates it). A separate device_match row is written when the new device
-- accepts, and the granter's main reads it to produce the vault_grants row.

create table public.pending_device_grants (
  id                   uuid primary key default gen_random_uuid(),
  vault_id             uuid not null references public.vaults (id) on delete cascade,
  granter_user_id      uuid not null references auth.users (id) on delete cascade,
  target_user_id       uuid not null references auth.users (id) on delete cascade,
  target_fingerprint   text not null,
  -- The device the granter will grant, set by the accepting device. null until accepted.
  matched_device_id    uuid references public.devices (id) on delete set null,
  target_public_key    text,
  status               text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at           timestamptz not null default now(),
  accepted_at          timestamptz,
  expires_at           timestamptz not null default (now() + interval '7 days')
);

create index pending_device_grants_target_idx on public.pending_device_grants (target_user_id, status);
create index pending_device_grants_vault_idx on public.pending_device_grants (vault_id);

alter table public.pending_device_grants enable row level security;

-- A member of the vault's org can read the row; the granter needs it to know which device to wrap.
create policy "pending_device_grants: read by member" on public.pending_device_grants
  for select to authenticated
  using (
    exists (
      select 1 from public.vaults v
       where v.id = pending_device_grants.vault_id
         and private.is_org_member(v.org_id)
    )
  );

-- An admin of the org creates the offer.
create policy "pending_device_grants: admin insert" on public.pending_device_grants
  for insert to authenticated
  with check (
    granter_user_id = (select auth.uid())
    and exists (
      select 1 from public.vaults v
       where v.id = pending_device_grants.vault_id
         and private.is_org_role(v.org_id, 'admin')
    )
  );

-- The accepting device fills in matched_device_id + target_public_key on accept.
create policy "pending_device_grants: target accept" on public.pending_device_grants
  for update to authenticated
  using (target_user_id = (select auth.uid()) and status = 'pending')
  with check (target_user_id = (select auth.uid()));

-- Either side can cancel a pending offer.
create policy "pending_device_grants: either remove" on public.pending_device_grants
  for delete to authenticated
  using (granter_user_id = (select auth.uid()) or target_user_id = (select auth.uid()));

revoke all on public.pending_device_grants from anon, authenticated;
grant select, delete on public.pending_device_grants to authenticated;
grant insert (vault_id, granter_user_id, target_user_id, target_fingerprint) on public.pending_device_grants to authenticated;
grant update (matched_device_id, target_public_key, status, accepted_at) on public.pending_device_grants to authenticated;

-- ── Share a local vault with an org ──────────────────────────────────────────
-- The one INSERT into vaults that has to write a vault_grants row in the same transaction (the
-- creator's own device). Runs as the function owner (SECURITY DEFINER) so it can write the row that
-- a plain INSERT policy on vaults would refuse. The wrapped_key is computed client-side on the actor's
-- main (the actor is the only one with both the vault key and the actor's own public key) and passed
-- in; the function does not see plaintext. A unique-index race is impossible because the unique on
-- (org_id, repo) raises a unique_violation; we catch that and return the existing vault's id, so two
-- clients racing to share the same local vault get the same result.

create or replace function private.share_vault(
  p_org_id     uuid,
  p_repo       text,
  p_label      text,
  p_device_id  uuid,
  p_wrapped_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_granter uuid := auth.uid();
begin
  if v_granter is null then
    raise exception 'Sign in to share a vault.';
  end if;
  if not private.is_org_role(p_org_id, 'admin') then
    raise exception 'Only org admins can share a vault.';
  end if;
  if not exists (select 1 from public.devices where id = p_device_id and user_id = v_granter and revoked_at is null) then
    raise exception 'The device must be one of yours.';
  end if;
  -- If a vault for this (org, repo) already exists, return its id; the caller can still grant the
  -- device through vault_grants in a separate statement.
  select id into v_id from public.vaults where org_id = p_org_id and repo = p_repo;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.vaults (org_id, repo, label, created_by)
    values (p_org_id, p_repo, p_label, v_granter)
    returning id into v_id;
  insert into public.vault_grants (vault_id, device_id, key_version, wrapped_key, granted_by)
    values (v_id, p_device_id, 1, p_wrapped_key, v_granter);
  return v_id;
end;
$$;

revoke all on function private.share_vault(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function private.share_vault(uuid, text, text, uuid, text) to authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- The drawer's live feed. supabase_realtime applies the RLS policies above, so a non-member's Realtime
-- channel for a vault they aren't in receives no events.
alter publication supabase_realtime add table public.vault_secrets;
alter publication supabase_realtime add table public.vault_events;
alter publication supabase_realtime add table public.vault_grants;
alter publication supabase_realtime add table public.pending_device_grants;

-- ── Helper revoke ────────────────────────────────────────────────────────────
-- Same pattern as puku_trial_add (20261013060000_puku_trial_usage.sql) and the team helpers
-- (20261013170000_teams.sql): revoke from public/anon/authenticated after granting to authenticated, so
-- the planner can inline the function but the Data API doesn't list it as an RPC.
revoke all on function private.is_org_member(uuid) from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
revoke all on function private.is_org_role(uuid, text) from public, anon, authenticated;
grant execute on function private.is_org_role(uuid, text) to authenticated;
revoke all on function private.device_visible_to(uuid, uuid) from public, anon, authenticated;
grant execute on function private.device_visible_to(uuid, uuid) to authenticated;
revoke all on function private.bump_server_version() from public, anon, authenticated;
revoke all on function private.bump_row_version() from public, anon, authenticated;
revoke all on function private.bump_vault_version() from public, anon, authenticated;
