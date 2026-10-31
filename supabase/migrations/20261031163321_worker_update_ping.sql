-- A second run of 20261031162204_worker_update_ping.sql, retried by hand after it had already landed. It changed
-- nothing; this file is here so the folder matches the database's history.
create or replace function public.worker_update_ping()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'push', 'worker-updates', false);
end;
$$;

revoke all on function public.worker_update_ping() from public, anon, authenticated;
grant execute on function public.worker_update_ping() to service_role;

alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update'));
