-- A Weft Worker's project snapshots (docs/architecture/project-hosts.md, phase H4): what the desktop board's header
-- badges read about a folder (code quality, the scout's findings, the uncommitted pile, the Backlog), measured on the
-- worker and published here, so a badge reads at once instead of waiting on a round trip to the worker. One row per
-- (worker, folder), written on a change and at least every 10 minutes while the worker is up (lib/worker-projects.ts);
-- its updated_at is the age the board shows ("12 min ago, m1mini offline").

-- 1. The table. The workspace reads it, like cloud_cards: scores, counts and findings, never a secret or a file's text.
create table if not exists public.cloud_worker_projects (
  worker_id  uuid not null references public.cloud_workers (id) on delete cascade,
  org_id     uuid not null references public.orgs (id) on delete cascade,
  -- The project's name on the worker, as lib/worker-paths.ts repoPath takes it: plain segments, none hidden.
  folder     text not null check (char_length(folder) between 1 and 200 and folder !~ '(^|/)\.' and folder !~ '\\'),
  snapshot   jsonb not null check (pg_column_size(snapshot) <= 65536),
  updated_at timestamptz not null default now(),
  primary key (worker_id, folder)
);

create index if not exists cloud_worker_projects_org on public.cloud_worker_projects (org_id);

alter table public.cloud_worker_projects enable row level security;
revoke all on public.cloud_worker_projects from anon, authenticated;

-- The owner and the workspace's members read; nobody writes as a user. The worker writes through worker_put_project.
create policy "cloud_worker_projects: read as member" on public.cloud_worker_projects
  for select to authenticated using (private.is_org_member(org_id));
grant select on public.cloud_worker_projects to authenticated;

-- 2. The worker's write: key-checked like every worker_* function, so only the worker itself puts its own rows, in its
-- own workspace. A worker reports at most 500 folders (worker_set_folders' cap), so it can't fill the table.
create or replace function public.worker_put_project(p_key text, p_folder text, p_snapshot jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'a snapshot is an object';
  end if;
  if not exists (select 1 from public.cloud_worker_projects where worker_id = w.id and folder = p_folder)
     and (select count(*) from public.cloud_worker_projects where worker_id = w.id) >= 500 then
    raise exception 'that is too many projects';
  end if;
  insert into public.cloud_worker_projects (worker_id, org_id, folder, snapshot, updated_at)
  values (w.id, w.org_id, p_folder, p_snapshot, now())
  on conflict (worker_id, folder) do update
    set snapshot = excluded.snapshot, org_id = excluded.org_id, updated_at = now();
end;
$$;

revoke all on function public.worker_put_project(text, text, jsonb) from public;
grant execute on function public.worker_put_project(text, text, jsonb) to anon, authenticated;
