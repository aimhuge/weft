-- The `host` command (docs/architecture/project-hosts.md, phase H2): one cloud_commands kind that carries any verb of
-- lib/host-api as `{ verb, args }`, so a board reaches every verb a host runs without a new kind per feature. The host
-- that runs it (a Weft Worker, or a Mac's inbox) writes what came of it to the new `result` column.

-- 1. The kind. Every kind already allowed stays (reply, answer, stop and mode still arrive from the phone and weft.zip).
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update', 'host'));

-- 2. The result: `{ ok: true, cardId }` or `{ ok: false, error }` (lib/host-command.ts HostResult). Never the card or its
-- thread, which travel sealed. Null until a host reports, and for the other kinds.
alter table public.cloud_commands add column if not exists result jsonb;
-- Small by design: either writer (a worker's report, or the author's own row) can't park a large blob in it.
alter table public.cloud_commands add constraint cloud_commands_result_small
  check (result is null or pg_column_size(result) <= 4096);

-- 3. A Mac's inbox reports with the author's own session, through the "update own" policy (created_by = auth.uid()),
-- so result joins the columns it may set.
grant update (status, card_id, error, result) on public.cloud_commands to authenticated;

-- 4. A worker reports through worker_report, which gains p_result. It is the same function, not a second path: the
-- same key check, and the row still has to be claimed and addressed to this worker. p_result defaults to null, so a
-- worker that predates it (calling with five named args) still reports, and leaves result as it was.
drop function if exists public.worker_report(text, uuid, text, text, text);

create or replace function public.worker_report(p_key text, p_command uuid, p_status text, p_card text, p_error text, p_result jsonb default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if p_status not in ('done', 'failed') then
    raise exception 'a report is done or failed';
  end if;
  perform set_config('weft.worker_id', w.id::text, true);
  update public.cloud_commands
    set status = p_status, card_id = coalesce(p_card, card_id), error = left(p_error, 300), result = coalesce(p_result, result)
    where id = p_command and status = 'claimed' and target_device = 'worker:' || w.id::text;
end;
$$;

revoke all on function public.worker_report(text, uuid, text, text, text, jsonb) from public;
grant execute on function public.worker_report(text, uuid, text, text, text, jsonb) to anon, authenticated;
