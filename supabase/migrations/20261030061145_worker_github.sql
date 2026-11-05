-- Cloning a repo onto a Weft Worker with no thread, and signing the worker in to GitHub from Weft
-- (docs/architecture/weft-worker.md#cloning-onto-a-worker). `clone` carries a git URL; `github_login` carries a token
-- sealed to the worker (lib/worker-seal.ts), so Supabase holds only bytes that worker can open. The worker reports the
-- account its git credentials belong to, never the token, and the row shows it.

alter table public.cloud_workers
  add column if not exists github_account text check (github_account is null or char_length(github_account) <= 100),
  add column if not exists github_state text check (github_state is null or github_state in ('signed_in', 'expired', 'none'));

grant select (github_account, github_state) on public.cloud_workers to authenticated;

alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login'));

-- An expired sign-in keeps the account it was, so the row can say whose it was. None clears it.
create or replace function public.worker_set_github(p_key text, p_state text, p_account text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if p_state is null or p_state not in ('signed_in', 'expired', 'none') then
    raise exception 'that is not a GitHub sign-in state';
  end if;
  update public.cloud_workers
    set github_state = p_state,
        github_account = case when p_state = 'none' then null else coalesce(left(p_account, 100), github_account) end
    where id = w.id;
end;
$$;

revoke all on function public.worker_set_github(text, text, text) from public;
grant execute on function public.worker_set_github(text, text, text) to anon, authenticated;
