-- A Weft Worker's project snapshots go live (docs/architecture/project-hosts.md, H4; docs/architecture/weft-worker.md).
-- cloud_worker_projects (20261102141500_worker_projects.sql) was only read: the desktop board's header badges asked for
-- a folder's row when a turn ended or the window took focus, so a worker's new measure waited on the next such read.
-- With the table in the Realtime publication, the desktop's server (the account's own session, lib/worker-project-live.ts)
-- hears each new snapshot and tells the board, which reads that folder's row again at once. The read stays the fallback,
-- so a database without this migration behaves exactly as before.
--
-- Who hears what: postgres_changes applies the table's select policy to each subscriber, so a change reaches only the
-- signed-in members of the row's workspace ("cloud_worker_projects: read as member", private.is_org_member(org_id)),
-- the same people who may select it. anon has no grant on the table, so a keyless client hears nothing. The rows carry
-- scores, counts and findings, never a secret or a file's text, and are capped at 64 KB each.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cloud_worker_projects'
  ) then
    alter publication supabase_realtime add table public.cloud_worker_projects;
  end if;
end;
$$;
