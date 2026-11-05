-- Tunnels (docs/architecture/tunnels.md). A quick tunnel's URL changes on every start, so a row keeps the current one
-- behind a stable address, /t/<id>. ticket_secret signs the short tickets the Mac's gate honours. The Mac replaces it
-- on each open and clears it on close, and only the service role can read it: an owner's grants skip that column.

create table public.tunnels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  public_url text,
  ticket_secret text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create index tunnels_user_id on public.tunnels (user_id);

alter table public.tunnels enable row level security;

create policy "tunnels: read own" on public.tunnels
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "tunnels: add own" on public.tunnels
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tunnels: change own" on public.tunnels
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tunnels: remove own" on public.tunnels
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.tunnels from anon, authenticated;
grant select (id, user_id, name, public_url, expires_at, updated_at) on public.tunnels to authenticated;
grant insert (id, name, public_url, ticket_secret, expires_at) on public.tunnels to authenticated;
grant update (name, public_url, ticket_secret, expires_at, updated_at) on public.tunnels to authenticated;
grant delete on public.tunnels to authenticated;

-- A webhook relay can answer through a tunnel while one is open. tunnel_path is the route on the dev server.
alter table public.webhook_relays
  add column tunnel_id uuid references public.tunnels (id) on delete set null,
  add column tunnel_path text;

grant update (tunnel_id, tunnel_path) on public.webhook_relays to authenticated;
