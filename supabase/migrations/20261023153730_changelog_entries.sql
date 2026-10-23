-- Every project's changelog, mirrored from the Mac's ~/.weft/changelog.jsonl (lib/changelog.ts, lib/changelog-sync.ts):
-- one row per entry a thread recorded with mcp__board__changelog_add, naming the card that wrote it, stamped with
-- the commit that shipped it and the version that released it. The Mac upserts each entry it changed; a removed entry
-- comes up as deleted. Only its own account reads or writes its rows (docs/architecture/changelog.md).

create table public.changelog_entries (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id           text not null check (char_length(id) between 1 and 64),
  project      text not null check (char_length(project) <= 1024),
  project_name text not null check (char_length(project_name) <= 256),
  kind         text not null check (kind in ('added', 'changed', 'fixed', 'removed', 'security')),
  text         text not null check (char_length(text) <= 8000),
  card_id      text check (char_length(card_id) <= 64),
  card_title   text check (char_length(card_title) <= 512),
  sha          text check (sha ~ '^[0-9a-f]{7,64}$'),
  committed_at timestamptz,
  version      text check (char_length(version) <= 64),
  released_at  timestamptz,
  created_at   timestamptz not null,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create index changelog_entries_project on public.changelog_entries (user_id, project, created_at desc);

alter table public.changelog_entries enable row level security;

create policy "own changelog: read" on public.changelog_entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own changelog: add" on public.changelog_entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own changelog: update" on public.changelog_entries
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
