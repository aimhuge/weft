-- A Mac's projects, for create_card on one of the owner's Weft Workers (docs/architecture/project-hosts.md#board-tools-on-a-worker).
-- A worker thread found a Mac project only by the folders of its synced cards, so a project just added on the Mac (no
-- cards yet) was "No project" there. Each Mac now publishes (lib/mac-projects.ts) the folders it would take a card for,
-- the ones Sync is on for, and its home folder (so `~/dev/app` means that Mac's ~) to cloud_mac_projects with its own
-- session, and the worker reads its owner's through worker_mac_projects(key).
--
-- Only absolute paths travel, and only for Macs that are the owner's, in the worker's workspace and not revoked (what
-- worker_board_macs lists). The function rebuilds the list from the strings alone, so a Mac (or anyone holding the
-- session) that writes more still hands a worker no more.

create table public.cloud_mac_projects (
  owner_user uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device     text not null check (char_length(device) between 1 and 100),
  home       text not null default '' check (char_length(home) <= 500),
  folders    jsonb not null default '[]'::jsonb check (jsonb_typeof(folders) = 'array' and octet_length(folders::text) <= 128000),
  updated_at timestamptz not null default now(),
  primary key (owner_user, device)
);

alter table public.cloud_mac_projects enable row level security;
revoke all on public.cloud_mac_projects from anon, authenticated;

create policy "cloud_mac_projects: read own" on public.cloud_mac_projects
  for select to authenticated using ((select auth.uid()) = owner_user);
create policy "cloud_mac_projects: insert own" on public.cloud_mac_projects
  for insert to authenticated with check ((select auth.uid()) = owner_user);
create policy "cloud_mac_projects: update own" on public.cloud_mac_projects
  for update to authenticated using ((select auth.uid()) = owner_user) with check ((select auth.uid()) = owner_user);
create policy "cloud_mac_projects: delete own" on public.cloud_mac_projects
  for delete to authenticated using ((select auth.uid()) = owner_user);
grant select, insert, update, delete on public.cloud_mac_projects to authenticated;

create or replace function public.worker_mac_projects(p_key text)
returns table (device text, home text, folders text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  return query
    select m.device, m.home,
           coalesce(array(
             select e #>> '{}'
             from jsonb_array_elements(m.folders) e
             where jsonb_typeof(e) = 'string' and left(e #>> '{}', 1) = '/' and char_length(e #>> '{}') <= 500
             limit 200
           ), '{}'::text[])
    from public.cloud_mac_projects m
    where m.owner_user = w.owner_user
      and exists (select 1 from public.cloud_workers d
                  where d.kind = 'desktop' and d.device = m.device and d.owner_user = w.owner_user and d.org_id = w.org_id
                    and d.revoked_at is null)
    order by m.updated_at desc
    limit 20;
end;
$$;

revoke all on function public.worker_mac_projects(text) from public;
grant execute on function public.worker_mac_projects(text) to anon, authenticated;
