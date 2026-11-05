-- What a Weft Worker runs, on its row (docs/architecture/weft-worker.md#auto-updates): the build as 0.6.7+abc1234, and
-- why it isn't on the newest commit, when it isn't. A worker updates itself, so without this nobody could tell whether
-- it had. Reported through the worker's key, like its GitHub sign-in.

alter table public.cloud_workers
  add column if not exists build text check (build is null or char_length(build) <= 60),
  add column if not exists update_note text check (update_note is null or char_length(update_note) <= 400);

grant select (build, update_note) on public.cloud_workers to authenticated;

create or replace function public.worker_set_build(p_key text, p_build text, p_note text)
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
    set build = left(p_build, 60), update_note = left(p_note, 400)
    where id = w.id;
end;
$$;

revoke all on function public.worker_set_build(text, text, text) from public;
grant execute on function public.worker_set_build(text, text, text) to anon, authenticated;
