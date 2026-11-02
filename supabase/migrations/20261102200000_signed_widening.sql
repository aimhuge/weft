-- The `pin` command (docs/architecture/project-hosts.md#signed-widening-as-built): a Mac's endorsements of the passkeys
-- it paired, each signed with its desktop approval key after Touch ID, for one worker to pin. The worker checks each
-- against the Mac key it pinned out of band (the pairing code, or `weft-worker trust`), so a row a stolen session
-- inserts pins nothing. Signed widenings themselves ride inside `host`, `run`, `new_card` and the line: no new kind.
--
-- The list names every kind on main plus `pin`, so it can run after 20261102170000_secret_use.sql.

alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update', 'host', 'line', 'secret_use', 'pin'));
