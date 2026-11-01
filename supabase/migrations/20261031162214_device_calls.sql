-- Manual QA mode (docs/architecture/manual-qa.md): a worker's card drives a device on its owner's Mac. The call runs the
-- other way from cloud_commands, worker to Mac, so it has a table of its own. Every workspace member reads
-- cloud_commands, and these rows carry screenshots and logs, and a worker must never gain a way to write rows into the
-- table a Mac obeys. Only the owner reads a call here, and a row is deleted once the worker has read its answer.
create table public.device_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  owner_user uuid not null references auth.users (id) on delete cascade,
  worker_id uuid not null references public.cloud_workers (id) on delete cascade,
  target_device text not null,
  card_id text not null,
  tool text not null check (tool in ('list_devices', 'boot', 'install', 'launch', 'open_url', 'ui_tree', 'tap', 'swipe', 'type_text', 'press', 'screenshot', 'logs', 'watch')),
  args jsonb not null default '{}'::jsonb check (pg_column_size(args) < 65536),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'failed')),
  result jsonb check (pg_column_size(result) < 4194304),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index device_calls_target on public.device_calls (target_device, status, created_at);

alter table public.device_calls enable row level security;

create policy "device_calls: read your own" on public.device_calls
  for select to authenticated using (owner_user = auth.uid());

create policy "device_calls: answer your own" on public.device_calls
  for update to authenticated using (owner_user = auth.uid()) with check (owner_user = auth.uid());

-- A Mac only claims and answers. Rows come from worker_device_call, so no client can queue a call by hand.
revoke all on public.device_calls from anon, authenticated;
grant select on public.device_calls to authenticated;
grant update (status, result, error, updated_at) on public.device_calls to authenticated;

alter publication supabase_realtime add table public.device_calls;

-- Queues a call for the Mac, or null when that Mac isn't there: not one of this worker's account's desktops, or no beat
-- for a minute. The card has to be this worker's. Leftovers of a turn that died go here, an hour on.
create or replace function public.worker_device_call(p_key text, p_device text, p_card text, p_tool text, p_args jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  made uuid;
begin
  delete from public.device_calls where worker_id = w.id and created_at < now() - interval '1 hour';
  if not exists (
    select 1 from public.cloud_cards c
    where c.org_id = w.org_id and c.card_id = p_card and c.owner_worker = w.id
  ) then
    raise exception 'that card is not this worker''s' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cloud_workers d
    where d.kind = 'desktop' and d.device = p_device and d.owner_user = w.owner_user and d.org_id = w.org_id
      and d.last_seen_at > now() - interval '60 seconds'
  ) then
    return null;
  end if;
  insert into public.device_calls (org_id, owner_user, worker_id, target_device, card_id, tool, args)
    values (w.org_id, w.owner_user, w.id, p_device, p_card, p_tool, coalesce(p_args, '{}'::jsonb))
    returning id into made;
  return made;
end;
$$;

-- A call's state. An answered call is deleted as it's read, so a screenshot lives no longer than it has to.
create or replace function public.worker_device_result(p_key text, p_call uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  c public.device_calls;
begin
  select * into c from public.device_calls where id = p_call and worker_id = w.id;
  if c.id is null then
    return null;
  end if;
  if c.status in ('done', 'failed') then
    delete from public.device_calls where id = c.id;
  end if;
  return jsonb_build_object('status', c.status, 'result', c.result, 'error', c.error);
end;
$$;

-- Takes back a call nobody claimed; true when it's gone, so a Mac waking later can't run a stale tap. False means the
-- Mac has it, and the worker waits for the answer.
create or replace function public.worker_device_cancel(p_key text, p_call uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  gone uuid;
begin
  delete from public.device_calls where id = p_call and worker_id = w.id and status = 'pending' returning id into gone;
  return gone is not null;
end;
$$;

revoke all on function public.worker_device_call(text, text, text, text, jsonb) from public;
revoke all on function public.worker_device_result(text, uuid) from public;
revoke all on function public.worker_device_cancel(text, uuid) from public;
grant execute on function public.worker_device_call(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.worker_device_result(text, uuid) to anon, authenticated;
grant execute on function public.worker_device_cancel(text, uuid) to anon, authenticated;

-- `qa` tells a worker to send a card's device tools to a Mac. It is only ever routing: the Mac holds the approval.
alter table public.cloud_commands drop constraint cloud_commands_kind_check;
alter table public.cloud_commands add constraint cloud_commands_kind_check
  check (kind in ('new_card', 'reply', 'answer', 'stop', 'run', 'login', 'clone', 'github_login', 'mode', 'input', 'qa'));
