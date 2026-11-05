-- Site notes: shared, cloud-hosted notes about websites the browser pane drives (docs/architecture/site-notes.md).
--
-- A note is one Markdown page per host and general path (`supabase.com` + `/dashboard/project/:ref/settings/api`),
-- in one of two cloud tiers: a workspace's own notes (scope 'team', org_id set) or everyone's (scope 'public',
-- org_id null). The local tier lives on the Mac in ~/.weft/site-notes and never reaches this database.
--
-- Every upload is a version; a card that used a version reports whether its flow worked. A public version is
-- served to everyone only once 3 different users (not its author) have succeeded with it, and a failure newer
-- than the last success marks it stale. The rule is computed in lib/site-notes-status.ts from these rows.
--
-- Like the org tables, all three are service-role only: RLS on, no policies, nothing granted to anon or
-- authenticated. weft.zip's /api/site-notes/cloud is the one door, and it re-scrubs and re-scans every body.

create table public.site_notes (
  id uuid primary key default gen_random_uuid(),
  host text not null check (host ~ '^[a-z0-9.-]{1,253}$'),
  path text not null check (char_length(path) between 1 and 300 and path like '/%'),
  scope text not null check (scope in ('team', 'public')),
  org_id uuid references public.orgs (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A team note names its workspace; a public one belongs to no one.
  check ((scope = 'team') = (org_id is not null)),
  unique nulls not distinct (host, path, scope, org_id)
);
create index site_notes_host_idx on public.site_notes (host);
create index site_notes_org_idx on public.site_notes (org_id) where org_id is not null;

create table public.site_note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.site_notes (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 6000),
  body_hash text not null,
  author_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (note_id, body_hash)
);
create index site_note_versions_note_idx on public.site_note_versions (note_id, created_at desc);
create index site_note_versions_author_idx on public.site_note_versions (author_id);

-- One row per user per version: their latest outcome with it. Distinct users are what confirm a version.
create table public.site_note_reports (
  version_id uuid not null references public.site_note_versions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  outcome text not null check (outcome in ('success', 'failure')),
  step text check (char_length(step) <= 300),
  updated_at timestamptz not null default now(),
  primary key (version_id, user_id)
);
create index site_note_reports_user_idx on public.site_note_reports (user_id);

-- Team sharing follows the workspace: on by default, an owner can turn it off.
alter table public.orgs add column site_notes_team boolean not null default true;

alter table public.site_notes enable row level security;
alter table public.site_note_versions enable row level security;
alter table public.site_note_reports enable row level security;
revoke all on public.site_notes, public.site_note_versions, public.site_note_reports from anon, authenticated;
