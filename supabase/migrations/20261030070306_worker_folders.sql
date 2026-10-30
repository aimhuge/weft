-- The projects on a Weft Worker, so the desktop board can list one with no cards yet
-- (docs/architecture/weft-worker.md#worker-projects-on-the-desktop-board). The worker reports its folder names under
-- the work root, nothing else: never a path above it or a file in it.

alter table public.cloud_workers
  add column if not exists folders text[] not null default '{}';

grant select (folders) on public.cloud_workers to authenticated;

create or replace function public.worker_set_folders(p_key text, p_folders text[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if coalesce(array_length(p_folders, 1), 0) > 500 then
    raise exception 'that is too many folders';
  end if;
  update public.cloud_workers set folders = coalesce(p_folders, '{}') where id = w.id;
end;
$$;

revoke all on function public.worker_set_folders(text, text[]) from public;
grant execute on function public.worker_set_folders(text, text[]) to anon, authenticated;
