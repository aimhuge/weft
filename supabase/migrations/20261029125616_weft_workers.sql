-- The Weft Worker, phase 1 (docs/architecture/weft-worker.md): a headless host that claims `run` commands and
-- publishes the card and its thread the way a Mac does. Here: the worker registry, the one-time enrolment token,
-- the `run` kind, and the functions the worker calls with its key.
--
-- A worker isn't a person, so it has no auth.uid(). It presents its key (`wwk_…`) to these security-definer
-- functions, which check sha256(key) against cloud_workers.key_hash and then act for the worker. The raw key exists
-- only on the worker (~/.weft-worker/worker.json, mode 600). Each worker acts for the account that enrolled it
-- (owner_user): it only obeys that account's commands, and its cards carry that account as owner_user plus the
-- worker itself as owner_worker, so the web board's reply/stop/run commands reach it unchanged. A worker's device id
-- is `worker:<id>`, which is what a command's target_device names.

-- ─── The registry ────────────────────────────────────────────────────────────
create table public.cloud_workers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs (id) on delete cascade,
  owner_user   uuid not null references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  platform     text not null check (platform in ('darwin', 'linux', 'win32')),
  arch         text not null default '' check (char_length(arch) <= 20),
  labels       jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  status       text not null default 'offline' check (status in ('online', 'busy', 'offline')),
  key_hash     text not null unique,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

create index cloud_workers_org on public.cloud_workers (org_id);

alter table public.cloud_workers enable row level security;
revoke all on public.cloud_workers from anon, authenticated;

-- The workspace sees its workers (never key_hash: the column grant leaves it out); the owner removes one.
create policy "cloud_workers: read as member" on public.cloud_workers
  for select to authenticated using (private.is_org_member(org_id));
grant select (id, org_id, owner_user, name, platform, arch, labels, capabilities, status, last_seen_at, created_at)
  on public.cloud_workers to authenticated;
create policy "cloud_workers: delete own" on public.cloud_workers
  for delete to authenticated using ((select auth.uid()) = owner_user);
grant delete on public.cloud_workers to authenticated;

alter publication supabase_realtime add table public.cloud_workers;

-- One-time enrolment tokens: made by a signed-in member (worker_enrol_token), shown once, exchanged by the box for
-- its own key (worker_enrol) within the hour. Only the functions touch this table.
create table public.cloud_worker_enrolments (
  token_hash text primary key,
  org_id     uuid not null references public.orgs (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  worker_id  uuid references public.cloud_workers (id) on delete set null
);

alter table public.cloud_worker_enrolments enable row level security;
revoke all on public.cloud_worker_enrolments from anon, authenticated;

-- ─── Cards and commands learn about workers ──────────────────────────────────
alter table public.cloud_cards
  add column if not exists owner_worker uuid references public.cloud_workers (id) on delete cascade;

alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run'));

-- A command may target a worker you enrolled, as well as a Mac you've run cards on.
create or replace function private.owns_device(device text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cloud_cards c
    where c.owner_device = device and c.owner_user = (select auth.uid())
  ) or exists (
    select 1 from public.cloud_workers w
    where 'worker:' || w.id::text = device and w.owner_user = (select auth.uid())
  );
$$;

-- The card_id guard (20261018130000) asks whether the caller owns the card. A worker's report runs inside
-- worker_report, which names the worker in the `weft.worker_id` setting for the transaction; the card then has to
-- be that worker's.
create or replace function private.cloud_commands_card_id_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  worker text := nullif(current_setting('weft.worker_id', true), '');
begin
  if NEW.card_id is not null and (OLD.card_id is null or NEW.card_id <> OLD.card_id) then
    if OLD.status <> 'claimed' then
      raise exception 'card_id may only be set on a claimed command';
    end if;
    if worker is not null then
      if not exists (
        select 1 from public.cloud_cards c
        where c.org_id = NEW.org_id and c.card_id = NEW.card_id and c.owner_worker = worker::uuid
      ) then
        raise exception 'card_id must point at a card the worker owns';
      end if;
    elsif not private.card_owned_by_caller(NEW.org_id, NEW.card_id) then
      raise exception 'card_id must point at a card the caller owns';
    end if;
  end if;
  return NEW;
end;
$$;

-- ─── The worker's key ────────────────────────────────────────────────────────
create or replace function private.sha256_hex(value text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(extensions.digest(value, 'sha256'), 'hex'); $$;

-- The worker a key belongs to, or an error. Every worker function starts here.
create or replace function private.worker_for_key(p_key text)
returns public.cloud_workers
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers;
begin
  select * into w from public.cloud_workers where key_hash = private.sha256_hex(coalesce(p_key, ''));
  if w.id is null then
    raise exception 'unknown worker key' using errcode = '28000';
  end if;
  return w;
end;
$$;

revoke all on function private.sha256_hex(text) from public, anon, authenticated;
revoke all on function private.worker_for_key(text) from public, anon, authenticated;

-- ─── Enrolment ───────────────────────────────────────────────────────────────
-- A member asks for a token to paste on the box. Valid for an hour, once.
create or replace function public.worker_enrol_token(p_org uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  token text := 'wet_' || encode(extensions.gen_random_bytes(18), 'hex');
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org) then
    raise exception 'not a member of that workspace' using errcode = '42501';
  end if;
  insert into public.cloud_worker_enrolments (token_hash, org_id, created_by, expires_at)
    values (private.sha256_hex(token), p_org, (select auth.uid()), now() + interval '1 hour');
  return token;
end;
$$;

revoke all on function public.worker_enrol_token(uuid) from public, anon;
grant execute on function public.worker_enrol_token(uuid) to authenticated;

-- The box trades the token for its own worker and key. The key is returned once and never stored in the clear.
create or replace function public.worker_enrol(p_token text, p_name text, p_platform text, p_arch text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.cloud_worker_enrolments;
  key text := 'wwk_' || encode(extensions.gen_random_bytes(32), 'hex');
  w public.cloud_workers;
begin
  select * into e from public.cloud_worker_enrolments
    where token_hash = private.sha256_hex(coalesce(p_token, '')) for update;
  if e.token_hash is null or e.used_at is not null or e.expires_at < now() then
    raise exception 'that enrolment token is unknown, used or expired' using errcode = '28000';
  end if;
  insert into public.cloud_workers (org_id, owner_user, name, platform, arch, key_hash, status, last_seen_at)
    values (e.org_id, e.created_by, p_name, p_platform, coalesce(p_arch, ''), private.sha256_hex(key), 'online', now())
    returning * into w;
  update public.cloud_worker_enrolments set used_at = now(), worker_id = w.id where token_hash = e.token_hash;
  return jsonb_build_object('worker_id', w.id, 'org_id', w.org_id, 'owner_user', w.owner_user,
    'device', 'worker:' || w.id::text, 'key', key);
end;
$$;

-- ─── What a worker does with its key ─────────────────────────────────────────
create or replace function public.worker_heartbeat(p_key text, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  update public.cloud_workers
    set last_seen_at = now(), status = case when p_status in ('online', 'busy', 'offline') then p_status else 'online' end
    where id = w.id;
end;
$$;

-- The commands waiting for this worker: addressed to it, made by its account, in its workspace. Oldest first.
create or replace function public.worker_pending(p_key text)
returns setof public.cloud_commands
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  return query
    select * from public.cloud_commands c
    where c.target_device = 'worker:' || w.id::text and c.created_by = w.owner_user and c.org_id = w.org_id
      and c.status = 'pending'
    order by c.created_at
    limit 20;
end;
$$;

-- Claims one command; true only for the caller that moved it from pending, so a command can't run twice.
create or replace function public.worker_claim(p_key text, p_command uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  update public.cloud_commands set status = 'claimed'
    where id = p_command and status = 'pending' and target_device = 'worker:' || w.id::text
      and created_by = w.owner_user and org_id = w.org_id;
  return found;
end;
$$;

-- Says how a claimed command went.
create or replace function public.worker_report(p_key text, p_command uuid, p_status text, p_card text, p_error text)
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
    set status = p_status, card_id = coalesce(p_card, card_id), error = left(p_error, 300)
    where id = p_command and status = 'claimed' and target_device = 'worker:' || w.id::text;
end;
$$;

-- Upserts one of the worker's cards. A card another Mac or worker owns can't be taken over.
create or replace function public.worker_put_card(p_key text, p_card_id text, p_folder text, p_card jsonb, p_deleted boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if exists (select 1 from public.cloud_cards c where c.org_id = w.org_id and c.card_id = p_card_id
             and c.owner_worker is distinct from w.id) then
    raise exception 'that card belongs to another device' using errcode = '42501';
  end if;
  insert into public.cloud_cards (org_id, card_id, owner_device, owner_user, owner_worker, folder, card, deleted)
    values (w.org_id, p_card_id, 'worker:' || w.id::text, w.owner_user, w.id, p_folder, p_card, coalesce(p_deleted, false))
  on conflict (org_id, card_id) do update
    set folder = excluded.folder, card = excluded.card, deleted = excluded.deleted, updated_at = now();
end;
$$;

-- Upserts a batch of a worker card's thread items: [{seq, kind, item, at}], and the full results of tool calls
-- cut out of them: [{tool_id, result, bytes}]. p_from_seq, when set, first drops the items from that seq on
-- (a rewind), like the outbox's truncate.
create or replace function public.worker_put_items(p_key text, p_card_id text, p_items jsonb, p_outputs jsonb, p_from_seq int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if not exists (select 1 from public.cloud_cards c where c.org_id = w.org_id and c.card_id = p_card_id and c.owner_worker = w.id) then
    raise exception 'that card is not this worker''s' using errcode = '42501';
  end if;
  if p_from_seq is not null then
    delete from public.cloud_thread_items where org_id = w.org_id and card_id = p_card_id and seq >= p_from_seq;
  end if;
  insert into public.cloud_thread_items (org_id, card_id, seq, kind, item, at)
    select w.org_id, p_card_id, (i->>'seq')::int, i->>'kind', i->'item', (i->>'at')::timestamptz
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  on conflict (org_id, card_id, seq) do update set kind = excluded.kind, item = excluded.item, at = excluded.at;
  insert into public.cloud_tool_outputs (org_id, card_id, tool_id, result, bytes)
    select w.org_id, p_card_id, o->>'tool_id', o->>'result', (o->>'bytes')::int
    from jsonb_array_elements(coalesce(p_outputs, '[]'::jsonb)) o
  on conflict (org_id, card_id, tool_id) do update set result = excluded.result, bytes = excluded.bytes;
end;
$$;

-- The worker holds no Supabase session, so it calls these as anon; each one checks the key itself.
revoke all on function public.worker_enrol(text, text, text, text) from public;
revoke all on function public.worker_heartbeat(text, text) from public;
revoke all on function public.worker_pending(text) from public;
revoke all on function public.worker_claim(text, uuid) from public;
revoke all on function public.worker_report(text, uuid, text, text, text) from public;
revoke all on function public.worker_put_card(text, text, text, jsonb, boolean) from public;
revoke all on function public.worker_put_items(text, text, jsonb, jsonb, int) from public;
grant execute on function public.worker_enrol(text, text, text, text) to anon, authenticated;
grant execute on function public.worker_heartbeat(text, text) to anon, authenticated;
grant execute on function public.worker_pending(text) to anon, authenticated;
grant execute on function public.worker_claim(text, uuid) to anon, authenticated;
grant execute on function public.worker_report(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.worker_put_card(text, text, text, jsonb, boolean) to anon, authenticated;
grant execute on function public.worker_put_items(text, text, jsonb, jsonb, int) to anon, authenticated;
