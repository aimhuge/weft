-- Workers update on a push to main (docs/architecture/weft-worker.md#auto-updates). A signed GitHub webhook reaches
-- /api/github/push, which calls this to send one empty ping on a public topic every worker joins. Only the service
-- role may call it, though anyone with the publishable key can send on a public topic: the worker limits how often a
-- ping makes it fetch, and all a fetch can bring is what origin really has.
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

-- Update now, on a worker's row. device_calls landed just after this with its own list, so the follow-up
-- worker_update_kind is what really widens the live constraint.
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update'));
