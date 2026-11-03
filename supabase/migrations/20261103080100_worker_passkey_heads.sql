-- Passkey generations a worker can't miss (docs/architecture/project-hosts.md#signed-widening-as-built, "a worker refusing
-- passkey approvals while its generation is behind the Mac's latest").
--
-- Each time a Mac signs a worker's passkey set (electron/widen-endorse.cjs), it also signs a head, `weft-endorse-head-v1`
-- over {worker, generation, issuedAt}, with the same approval key, and inserts it here; it signs one again each day so a
-- worker always has a recent one. The worker reads every head for itself (worker_passkey_heads), keeps only those its
-- pinned Mac key signed (lib/passkey-head.ts), and refuses a passkey approval while the set it holds is older than the
-- newest of them. The database trusts nothing in a head and checks no signature: the worker does.
--
-- Why a log and not a column: a session (stolen, or a thread's) could overwrite a column with an older signed head, and
-- the worker would think it's up to date. Here rows are insert-only for clients, no one but the 30-day prune deletes
-- one, and the worker takes the highest generation over all of them, so an old head inserted again changes nothing and
-- junk only adds rows the worker skips. Rows past what one read returns make the worker refuse passkeys (fail closed),
-- so a flood can't push the real head out of sight.

create table if not exists public.worker_passkey_heads (
  id         bigint generated always as identity primary key,
  worker_id  uuid not null references public.cloud_workers (id) on delete cascade,
  owner_user uuid not null default auth.uid() references auth.users (id) on delete cascade,
  head       jsonb not null check (jsonb_typeof(head) = 'object' and pg_column_size(head) <= 1024),
  created_at timestamptz not null default now()
);

create index if not exists worker_passkey_heads_worker on public.worker_passkey_heads (worker_id, created_at desc);

alter table public.worker_passkey_heads enable row level security;

drop policy if exists "worker passkey heads: read own" on public.worker_passkey_heads;
create policy "worker passkey heads: read own" on public.worker_passkey_heads
  for select to authenticated using (owner_user = (select auth.uid()));

-- Only for a worker of your own (private.owns_worker: headless, not revoked), as yourself.
drop policy if exists "worker passkey heads: add own" on public.worker_passkey_heads;
create policy "worker passkey heads: add own" on public.worker_passkey_heads
  for insert to authenticated
  with check (owner_user = (select auth.uid()) and private.owns_worker(worker_id));

revoke all on table public.worker_passkey_heads from public, anon, authenticated;
grant select on table public.worker_passkey_heads to authenticated;
grant insert (worker_id, head) on table public.worker_passkey_heads to authenticated;

-- The prune: heads older than 30 days go, on each insert for that worker. Age is the database's clock, which no client
-- sets, so an insert can't make the real head look old. The Mac signs a fresh head daily, and the worker remembers the
-- highest generation it has seen, so a pruned head is never forgotten.
create or replace function private.prune_worker_passkey_heads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.worker_passkey_heads where worker_id = new.worker_id and created_at < now() - interval '30 days';
  return new;
end;
$$;

revoke all on function private.prune_worker_passkey_heads() from public, anon, authenticated;

drop trigger if exists worker_passkey_heads_prune on public.worker_passkey_heads;
create trigger worker_passkey_heads_prune after insert on public.worker_passkey_heads
  for each row execute function private.prune_worker_passkey_heads();

-- The worker's read: every head for itself from the last 30 days, newest first, at most 501. The worker treats 501 as
-- "more than it could check" and refuses passkeys until fewer remain.
create or replace function public.worker_passkey_heads(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  return coalesce((
    select jsonb_agg(h.head order by h.created_at desc)
      from (select head, created_at from public.worker_passkey_heads
             where worker_id = w.id and created_at > now() - interval '30 days'
             order by created_at desc
             limit 501) h
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.worker_passkey_heads(text) from public;
grant execute on function public.worker_passkey_heads(text) to anon, authenticated;
