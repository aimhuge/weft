-- Signing a Weft Worker's Claude Code in from Weft (docs/architecture/weft-worker.md#signing-claude-in). The worker
-- makes an X25519 keypair on its box and publishes the public half here; the desktop seals the Claude token to it
-- (lib/worker-seal.ts) and sends a `login` command. Supabase only ever holds the sealed bytes: every member of the
-- workspace can read cloud_commands, and the token must not be readable by any of them, or by a backup.

alter table public.cloud_workers
  add column if not exists public_key text check (public_key is null or char_length(public_key) <= 200);

grant select (public_key) on public.cloud_workers to authenticated;

alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login'));

-- The worker publishes its public key at start, so a worker enrolled before this keeps its enrolment.
create or replace function public.worker_set_public_key(p_key text, p_public_key text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if p_public_key is null or p_public_key !~ '^[A-Za-z0-9+/=]{40,200}$' then
    raise exception 'that is not a public key';
  end if;
  update public.cloud_workers set public_key = p_public_key where id = w.id;
end;
$$;

revoke all on function public.worker_set_public_key(text, text) from public;
grant execute on function public.worker_set_public_key(text, text) to anon, authenticated;
