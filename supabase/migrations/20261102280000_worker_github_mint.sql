-- Connectors on a worker, P1: GitHub through tokens minted off the box
-- (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built, project-hosts.md).
--
-- 1. connector_github_tokens: your GitHub App refresh token and current user access token, sealed by weft.zip
--    (lib/connector-crypto.ts). RLS on with no policy and no grant: only the service role (weft.zip's routes) reads it.
-- 2. connector_grants: your approval for one worker to use one connector, with its settings. Made, changed and deleted
--    only by your own session (Electron main, after Touch ID); weft.zip mints only under a live one.
-- 3. connector_allows: the per-project or per-card Allows a grant's approval setting asks for.
-- 4. connector_mints: the ledger, every answer the minter gave a worker. You read yours (Settings shows "last used").
-- 5. connector_live_tokens and connector_cards: service-only. The narrowed tokens handed out (so a revoke can delete
--    them at GitHub), and the cards a mint has checked you started (start commands expire after a day).
-- 6. A worker revoked (device_revoke) loses its grants at once.

create table if not exists public.connector_github_tokens (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  github_id          bigint not null,
  github_login       text not null check (char_length(github_login) <= 100),
  refresh_sealed     text not null,
  refresh_expires_at timestamptz not null,
  access_sealed      text,
  access_issued_at   timestamptz,
  access_expires_at  timestamptz,
  -- A refresh in flight (lib/connector-tokens.ts claims it), so two mints at once don't both spend the refresh token.
  refreshing_until   timestamptz,
  updated_at         timestamptz not null default now()
);
alter table public.connector_github_tokens enable row level security;
revoke all on table public.connector_github_tokens from public, anon, authenticated;

create table if not exists public.connector_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  worker_id    uuid not null references public.cloud_workers (id) on delete cascade,
  connector    text not null check (connector in ('github')),
  scope        text not null default 'installed' check (scope in ('installed', 'project', 'card')),
  approval     text not null default 'worker' check (approval in ('worker', 'project', 'card')),
  lifetime     text not null default 'revoked' check (lifetime in ('revoked', '24h', '8h')),
  asks         text[] not null default '{protected_push}' check (asks <@ array['protected_push']::text[]),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  last_used_at timestamptz,
  unique (user_id, worker_id, connector)
);
alter table public.connector_grants enable row level security;

-- The clock is the database's: created_at, expires_at (from the lifetime, restarted when it changes) and a fresh
-- last_used_at on insert, whatever the caller sent.
create or replace function private.connector_grants_clock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.last_used_at := null;
  end if;
  if tg_op = 'INSERT' or new.lifetime is distinct from old.lifetime then
    new.expires_at := case new.lifetime when '24h' then now() + interval '24 hours' when '8h' then now() + interval '8 hours' else null end;
  end if;
  return new;
end;
$$;
drop trigger if exists connector_grants_clock on public.connector_grants;
create trigger connector_grants_clock before insert or update on public.connector_grants
  for each row execute function private.connector_grants_clock();

-- Only for a paired worker of your own that isn't revoked: a token-enrolled worker has no sign key to sign a mint with.
create or replace function private.owns_paired_worker(p_worker uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cloud_workers w
     where w.id = p_worker and w.owner_user = (select auth.uid()) and w.kind = 'headless'
       and w.revoked_at is null and w.sign_key is not null
  );
$$;
revoke all on function private.owns_paired_worker(uuid) from public, anon;
grant execute on function private.owns_paired_worker(uuid) to authenticated;

drop policy if exists "connector grants: read own" on public.connector_grants;
create policy "connector grants: read own" on public.connector_grants for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "connector grants: make own" on public.connector_grants;
create policy "connector grants: make own" on public.connector_grants for insert to authenticated
  with check (user_id = (select auth.uid()) and private.owns_paired_worker(worker_id));
drop policy if exists "connector grants: change own" on public.connector_grants;
create policy "connector grants: change own" on public.connector_grants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and private.owns_paired_worker(worker_id));
drop policy if exists "connector grants: delete own" on public.connector_grants;
create policy "connector grants: delete own" on public.connector_grants for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on table public.connector_grants from public, anon, authenticated;
grant select, delete on table public.connector_grants to authenticated;
grant insert (worker_id, connector, scope, approval, lifetime, asks) on table public.connector_grants to authenticated;
grant update (scope, approval, lifetime, asks) on table public.connector_grants to authenticated;

create table if not exists public.connector_allows (
  id         uuid primary key default gen_random_uuid(),
  grant_id   uuid not null references public.connector_grants (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('project', 'card')),
  subject    text not null check (char_length(subject) between 1 and 201),
  created_at timestamptz not null default now(),
  unique (grant_id, kind, subject)
);
alter table public.connector_allows enable row level security;
drop policy if exists "connector allows: read own" on public.connector_allows;
create policy "connector allows: read own" on public.connector_allows for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "connector allows: make own" on public.connector_allows;
create policy "connector allows: make own" on public.connector_allows for insert to authenticated
  with check (user_id = (select auth.uid())
    and exists (select 1 from public.connector_grants g where g.id = grant_id and g.user_id = (select auth.uid())));
drop policy if exists "connector allows: delete own" on public.connector_allows;
create policy "connector allows: delete own" on public.connector_allows for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on table public.connector_allows from public, anon, authenticated;
grant select, delete on table public.connector_allows to authenticated;
grant insert (grant_id, kind, subject) on table public.connector_allows to authenticated;

create table if not exists public.connector_mints (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  worker_id  uuid not null references public.cloud_workers (id) on delete cascade,
  grant_id   uuid references public.connector_grants (id) on delete set null,
  connector  text not null,
  card_id    text check (char_length(card_id) <= 200),
  repo       text check (char_length(repo) <= 201),
  outcome    text not null check (outcome in ('minted', 'refused', 'needs_allow', 'revoked')),
  reason     text check (char_length(reason) <= 300),
  token_kind text check (token_kind in ('user', 'scoped')),
  nonce      text check (char_length(nonce) <= 64),
  at         timestamptz not null default now(),
  -- A signed request is answered once: its nonce can't be logged twice for a worker.
  unique (worker_id, nonce)
);
create index if not exists connector_mints_worker_at on public.connector_mints (worker_id, at desc);
create index if not exists connector_mints_user_at on public.connector_mints (user_id, at desc);
alter table public.connector_mints enable row level security;
drop policy if exists "connector mints: read own" on public.connector_mints;
create policy "connector mints: read own" on public.connector_mints for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on table public.connector_mints from public, anon, authenticated;
grant select on table public.connector_mints to authenticated;

create table if not exists public.connector_live_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  worker_id    uuid not null,
  subject      text not null check (char_length(subject) <= 201),
  repo         text not null check (char_length(repo) <= 201),
  token_sealed text not null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz,
  unique (worker_id, subject)
);
alter table public.connector_live_tokens enable row level security;
revoke all on table public.connector_live_tokens from public, anon, authenticated;

create table if not exists public.connector_cards (
  worker_id uuid not null references public.cloud_workers (id) on delete cascade,
  card_id   text not null check (char_length(card_id) <= 200),
  user_id   uuid not null references auth.users (id) on delete cascade,
  folder    text not null,
  repo      text not null,
  pinned_at timestamptz not null default now(),
  primary key (worker_id, card_id)
);
alter table public.connector_cards enable row level security;
revoke all on table public.connector_cards from public, anon, authenticated;

-- A revoked worker's grants go with it. Its live tokens are revoked at GitHub by weft.zip's revoke route, which the
-- desktop calls right after device_revoke (lib/device-registry.ts); the grant going here stops every mint at once
-- even if that call never arrives, and the worker's key no longer works either (device_revoke replaces key_hash).
create or replace function private.connector_grants_drop_revoked()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    delete from public.connector_grants where worker_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.connector_grants_drop_revoked() from public, anon, authenticated;
drop trigger if exists cloud_workers_drop_connector_grants on public.cloud_workers;
create trigger cloud_workers_drop_connector_grants after update of revoked_at on public.cloud_workers
  for each row execute function private.connector_grants_drop_revoked();
