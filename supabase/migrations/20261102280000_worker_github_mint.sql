-- Connectors on a worker, P1: GitHub through tokens minted off the box
-- (docs/architecture/connectors.md#connectors-on-a-worker-github-p1-as-built, project-hosts.md).
--
-- 1. connector_github_tokens: your GitHub App refresh token and current user access token, sealed by weft.zip
--    (lib/connector-crypto.ts). RLS on with no policy and no grant: only the service role (weft.zip's routes) reads it.
-- 2. connector_signers: the Mac keys that may say yes to a connector (each Mac's desktop approval key,
--    electron/desktop-signer.cjs). Written only by weft.zip (lib/connector-signers.ts), which checks the key's own
--    signature; a key is trusted once a trusted Mac vouches for it, or once you open the one-time link emailed to your
--    account's address. The email also carries a link that revokes the key with no session.
-- 3. connector_worker_pins: a worker vouched for by a Mac, the sign and box keys it checked at pairing, signed.
-- 4. connector_grants: your approval for one worker to use one connector, with its settings, signed by a signer.
--    Written only by weft.zip's grant route, which checks the signature; the mint checks it again. Your session reads.
-- 5. connector_allows: the per-project or per-card Allows a grant's approval setting asks for, signed the same way.
-- 6. connector_mints: the ledger, every answer the minter gave a worker, and the notices. You read yours.
--    connector_mint_admit logs a request under its nonce and both rate limits in one locked step.
-- 7. connector_live_tokens, connector_live_claims, connector_cards and connector_signed_nonces: service-only. The narrowed tokens handed out
--    or retired (so a revoke can delete them at GitHub), the cards a mint has checked you started, and the nonces of
--    signed statements taken.
-- 8. A worker revoked (device_revoke) loses its grants at once.
-- 9. worker_report no longer re-points a command's card: a card id set when the row was made stays.

create table if not exists public.connector_github_tokens (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  github_id          bigint not null,
  github_login       text not null check (char_length(github_login) <= 100),
  refresh_sealed     text not null,
  refresh_expires_at timestamptz not null,
  access_sealed      text,
  access_issued_at   timestamptz,
  access_expires_at  timestamptz,
  -- A refresh in flight (lib/connector-tokens.ts claims it), so two mints, or a mint and a revoke, don't both spend it.
  refreshing_until   timestamptz,
  -- Disconnect asked GitHub to delete the authorization and GitHub didn't confirm: nothing mints, the sweep retries.
  disconnect_pending_at timestamptz,
  updated_at         timestamptz not null default now()
);
alter table public.connector_github_tokens enable row level security;
revoke all on table public.connector_github_tokens from public, anon, authenticated;

create table if not exists public.connector_signers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  sign_key     text not null check (char_length(sign_key) = 44),
  name         text not null check (char_length(name) between 1 and 80),
  device       text check (char_length(device) <= 100),
  added_at     timestamptz not null default now(),
  -- Null until the emailed link is opened or a trusted Mac vouches for it.
  trusted_from timestamptz,
  endorsed_by  uuid references public.connector_signers (id) on delete set null,
  revoked_at   timestamptz,
  -- sha256 of the one-time confirm token (cleared once used) and of every revoke token emailed (each email's revoke link
  -- keeps working); never the tokens. confirm_sends caps how often a pending key's link is mailed.
  confirm_hash       text,
  confirm_expires_at timestamptz,
  confirm_sent_at    timestamptz,
  confirm_sends      int not null default 0,
  revoke_hashes      text[] not null default '{}' check (cardinality(revoke_hashes) <= 10),
  -- Where the registration came from, for the email.
  added_ip     text check (char_length(added_ip) <= 100),
  added_ua     text check (char_length(added_ua) <= 300),
  unique (user_id, sign_key)
);
alter table public.connector_signers enable row level security;
drop policy if exists "connector signers: read own" on public.connector_signers;
create policy "connector signers: read own" on public.connector_signers for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on table public.connector_signers from public, anon, authenticated;
grant select (id, user_id, sign_key, name, device, added_at, trusted_from, endorsed_by, revoked_at) on table public.connector_signers to authenticated;

create table if not exists public.connector_worker_pins (
  worker_id uuid primary key references public.cloud_workers (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  sign_key  text not null,
  box_key   text not null,
  signer_id uuid not null references public.connector_signers (id) on delete cascade,
  sig       text not null check (char_length(sig) <= 200),
  pinned_at timestamptz not null default now()
);
alter table public.connector_worker_pins enable row level security;
drop policy if exists "connector worker pins: read own" on public.connector_worker_pins;
create policy "connector worker pins: read own" on public.connector_worker_pins for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on table public.connector_worker_pins from public, anon, authenticated;
grant select on table public.connector_worker_pins to authenticated;

create table if not exists public.connector_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  worker_id    uuid not null references public.cloud_workers (id) on delete cascade,
  connector    text not null check (connector in ('github')),
  scope        text not null default 'project' check (scope in ('installed', 'project', 'card')),
  approval     text not null default 'worker' check (approval in ('worker', 'project', 'card')),
  lifetime     text not null default 'revoked' check (lifetime in ('revoked', '24h', '8h')),
  asks         text[] not null default '{protected_push}' check (asks <@ array['protected_push']::text[]),
  -- The repos (owner/name, lowercase) the grant covers, captured from the Mac's own checkouts when it was signed: the
  -- mint refuses a card in any other repo, whatever a checkout's origin says later.
  repos        text[] not null default '{}' check (cardinality(repos) <= 500),
  -- The signature over every field above (lib/connector-messages.ts grantMessage), by a signer, and what it named:
  -- its nonce and time, and the epoch it replaced (epoch - 1). Each signed change makes the epoch one more, and the
  -- mint answers only while the epoch it checked is still the grant's.
  signer_id    uuid not null references public.connector_signers (id) on delete cascade,
  sig          text not null check (char_length(sig) <= 200),
  nonce        text not null check (char_length(nonce) <= 64),
  issued_at    timestamptz not null,
  epoch        bigint not null default 1 check (epoch >= 1),
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

-- Your session reads its grants. Nothing but weft.zip writes them: a stolen session could otherwise loosen a grant
-- that no Touch ID saw. Turning one off is weft.zip's revoke route too, which also ends the tokens at GitHub.
drop policy if exists "connector grants: read own" on public.connector_grants;
create policy "connector grants: read own" on public.connector_grants for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "connector grants: make own" on public.connector_grants;
drop policy if exists "connector grants: change own" on public.connector_grants;
drop policy if exists "connector grants: delete own" on public.connector_grants;
drop function if exists private.owns_paired_worker(uuid);
revoke all on table public.connector_grants from public, anon, authenticated;
grant select on table public.connector_grants to authenticated;

create table if not exists public.connector_allows (
  id         uuid primary key default gen_random_uuid(),
  grant_id   uuid not null references public.connector_grants (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('project', 'card')),
  subject    text not null check (char_length(subject) between 1 and 201),
  signer_id  uuid not null references public.connector_signers (id) on delete cascade,
  sig        text not null check (char_length(sig) <= 200),
  nonce      text not null check (char_length(nonce) <= 64),
  issued_at  timestamptz not null,
  created_at timestamptz not null default now(),
  unique (grant_id, kind, subject)
);
alter table public.connector_allows enable row level security;
drop policy if exists "connector allows: read own" on public.connector_allows;
create policy "connector allows: read own" on public.connector_allows for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "connector allows: make own" on public.connector_allows;
drop policy if exists "connector allows: delete own" on public.connector_allows;
revoke all on table public.connector_allows from public, anon, authenticated;
grant select on table public.connector_allows to authenticated;

create table if not exists public.connector_signed_nonces (
  user_id uuid not null references auth.users (id) on delete cascade,
  nonce   text not null check (char_length(nonce) <= 64),
  at      timestamptz not null default now(),
  primary key (user_id, nonce)
);
alter table public.connector_signed_nonces enable row level security;
revoke all on table public.connector_signed_nonces from public, anon, authenticated;

create table if not exists public.connector_mints (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Null for a notice that names no worker (a new Mac key).
  worker_id  uuid references public.cloud_workers (id) on delete cascade,
  grant_id   uuid references public.connector_grants (id) on delete set null,
  connector  text not null,
  card_id    text check (char_length(card_id) <= 200),
  repo       text check (char_length(repo) <= 201),
  outcome    text not null check (outcome in ('minted', 'refused', 'needs_allow', 'revoked', 'notice')),
  reason     text check (char_length(reason) <= 300),
  token_kind text check (token_kind in ('user', 'scoped')),
  -- Which user access token a 'user' answer handed out (its access_issued_at), so a revoke knows this worker holds
  -- the current one even when its own mint did the refresh.
  token_issued_at timestamptz,
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

-- One request into the ledger, or why not: -1 its nonce was logged already, -2 a rate limit is spent. The counts and the
-- insert run under one lock per user, so two requests at once can't both slip under a limit.
create or replace function public.connector_mint_admit(p_row jsonb, p_worker_minute int, p_worker_hour int, p_user_minute int, p_user_hour int)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (p_row->>'user_id')::uuid;
  v_worker uuid := (p_row->>'worker_id')::uuid;
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('connector_mint:' || v_user::text, 0));
  if exists (select 1 from public.connector_mints where worker_id = v_worker and nonce = p_row->>'nonce') then
    return -1;
  end if;
  if (select count(*) from public.connector_mints where worker_id = v_worker and outcome <> 'notice' and at > now() - interval '1 minute') >= p_worker_minute
     or (select count(*) from public.connector_mints where worker_id = v_worker and outcome <> 'notice' and at > now() - interval '1 hour') >= p_worker_hour
     or (select count(*) from public.connector_mints where user_id = v_user and outcome <> 'notice' and at > now() - interval '1 minute') >= p_user_minute
     or (select count(*) from public.connector_mints where user_id = v_user and outcome <> 'notice' and at > now() - interval '1 hour') >= p_user_hour then
    return -2;
  end if;
  insert into public.connector_mints (user_id, worker_id, connector, card_id, repo, outcome, reason, nonce)
    values (v_user, v_worker, p_row->>'connector', p_row->>'card_id', p_row->>'repo', 'refused', 'in progress', p_row->>'nonce')
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.connector_mint_admit(jsonb, int, int, int, int) from public, anon, authenticated;
grant execute on function public.connector_mint_admit(jsonb, int, int, int, int) to service_role;

create table if not exists public.connector_live_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  worker_id    uuid not null,
  -- project:<repo> or card:<id> while it's handed out; retired:<uuid> once replaced and GitHub didn't confirm its delete.
  subject      text not null check (char_length(subject) <= 201),
  repo         text not null check (char_length(repo) <= 201),
  token_sealed text not null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz,
  unique (worker_id, subject)
);
alter table public.connector_live_tokens enable row level security;
revoke all on table public.connector_live_tokens from public, anon, authenticated;

-- A narrowed token being made for (worker, subject): one mint at a time, so none is made and lost beside another.
create table if not exists public.connector_live_claims (
  worker_id uuid not null,
  subject   text not null check (char_length(subject) <= 201),
  until     timestamptz not null,
  primary key (worker_id, subject)
);
alter table public.connector_live_claims enable row level security;
revoke all on table public.connector_live_claims from public, anon, authenticated;

create table if not exists public.connector_cards (
  worker_id uuid not null references public.cloud_workers (id) on delete cascade,
  card_id   text not null check (char_length(card_id) <= 200),
  user_id   uuid not null references auth.users (id) on delete cascade,
  folder    text not null,
  repo      text not null,
  -- The Mac key that signed the start (re-checked at every mint) and that signature, which pins one card only once.
  signer_id uuid references public.connector_signers (id) on delete cascade,
  start_sig text unique,
  pinned_at timestamptz not null default now(),
  -- Set once the card was seen Done or deleted: it never mints again, and its start can't pin it afresh.
  closed_at timestamptz,
  primary key (worker_id, card_id)
);
alter table public.connector_cards enable row level security;
revoke all on table public.connector_cards from public, anon, authenticated;

-- A revoked worker's grants go with it. Its live tokens are revoked at GitHub by weft.zip's revoke route, which the
-- desktop calls right after device_revoke (lib/device-registry.ts), and by the daily sweep for a worker with no grant;
-- the grant going here stops every mint at once even if that call never arrives, and the worker's key no longer works
-- either (device_revoke replaces key_hash).
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

-- worker_report as in 20261102094800_host_command.sql, except a card id the row already has stays: a worker names the
-- card a run or new_card became, but can't re-point a command whose card was named when it was made.
create or replace function public.worker_report(p_key text, p_command uuid, p_status text, p_card text, p_error text, p_result jsonb default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if p_status not in ('done', 'failed') then
    raise exception 'a report is done or failed';
  end if;
  perform set_config('weft.worker_id', w.id::text, true);
  update public.cloud_commands
    set status = p_status, card_id = coalesce(card_id, p_card), error = left(p_error, 300), result = coalesce(p_result, result)
    where id = p_command and status = 'claimed' and target_device = 'worker:' || w.id::text;
end;
$$;
revoke all on function public.worker_report(text, uuid, text, text, text, jsonb) from public;
grant execute on function public.worker_report(text, uuid, text, text, text, jsonb) to anon, authenticated;
