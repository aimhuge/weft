-- A worker's card can change mode from its thread, and its live screen takes taps. Both are commands, so they pass
-- through worker_pending's check: addressed to the worker and made by its account.
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input'));
