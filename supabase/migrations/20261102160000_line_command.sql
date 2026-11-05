-- The `line` command (docs/architecture/project-hosts.md#routes-the-webrtc-line, phase H6): a board's WebRTC offer,
-- sealed to a worker's published key, that opens the session line every card on that worker shares. It carries no
-- card and no verb: the line's own `host` channel runs verbs, through the same checks a `host` command passes.
--
-- The list names every kind on main plus both `line` and `secret_use` (H8, landing beside this), so whichever of the two
-- migrations runs last leaves the same constraint.

alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa', 'update', 'host', 'line', 'secret_use'));
