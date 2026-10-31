-- Puts back 'update' (Update now, docs/architecture/weft-worker.md#auto-updates): device_calls was applied right after
-- worker_update_ping and rewrote this constraint from a list without it.
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update'));
