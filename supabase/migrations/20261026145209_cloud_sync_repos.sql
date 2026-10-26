-- The GitHub repos a user has Project Sync on for (Settings → Sync), so the same project syncs on their other Macs.
-- Settings `syncFolders` holds local paths, which differ from Mac to Mac; this holds the repo ("owner/name"), and a
-- Mac that has a clone of an enabled repo turns sync on for it at sign-in, start or clone (lib/cloud-sync-repos.ts).
-- enabled = false remembers a repo turned off, so a Mac that still syncs it doesn't switch it back on for the rest.
create table public.cloud_sync_repos (
  owner_user uuid not null default auth.uid() references auth.users (id) on delete cascade,
  repo       text not null check (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (owner_user, repo)
);

create trigger cloud_sync_repos_touch_updated_at
  before update on public.cloud_sync_repos
  for each row execute function private.touch_updated_at();

alter table public.cloud_sync_repos enable row level security;

-- Supabase's default grants go first, then only what the policies need: each user reads and writes their own rows.
revoke all on public.cloud_sync_repos from anon, authenticated;

create policy "cloud_sync_repos: read own" on public.cloud_sync_repos
  for select to authenticated using ((select auth.uid()) = owner_user);
create policy "cloud_sync_repos: write own" on public.cloud_sync_repos
  for insert to authenticated with check ((select auth.uid()) = owner_user);
create policy "cloud_sync_repos: update own" on public.cloud_sync_repos
  for update to authenticated using ((select auth.uid()) = owner_user)
  with check ((select auth.uid()) = owner_user);

grant select, insert, update on public.cloud_sync_repos to authenticated;
