-- Board tools on a Weft Worker (docs/architecture/project-hosts.md#board-tools-on-a-worker). A thread on a worker used to
-- list, create and schedule against the worker's private store (WEFT_DATA), so the cards, crons and webhooks it made
-- never reached the user's board. Three key-checked functions, all scoped to the worker's owner, and one table:
--
--   worker_board_cards  the owner's synced cards in the worker's workspace (its own and every Mac's), for list_cards
--   worker_new_card     a new card for another host: `new_card` to one of the owner's Macs, `run` to another of their
--                       workers. Inserted as the owner, so the target's inbox obeys it under its usual checks (a Mac's
--                       synced folder and its own default permission mode; a worker's RUN_MODES)
--   worker_set_lists    the worker's crons and webhooks, published so the Mac's ⏰ and 🪝 drawers list them
--
-- cloud_worker_lists is readable by the worker's owner only: a cron's prompt is as private as a card's.

-- ─── The owner's board ─────────────────────────────────────────────────────────
create or replace function public.worker_board_cards(p_key text, p_limit int)
returns table (card_id text, folder text, owner_device text, owner_worker uuid, card jsonb, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  return query
    select c.card_id, c.folder, c.owner_device, c.owner_worker, c.card, c.updated_at
    from public.cloud_cards c
    where c.org_id = w.org_id and c.owner_user = w.owner_user and not c.deleted
    order by c.updated_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

revoke all on function public.worker_board_cards(text, int) from public;
grant execute on function public.worker_board_cards(text, int) to anon, authenticated;

-- ─── A card for another host ────────────────────────────────────────────────────
-- p_target is a Mac's device id (one the owner has synced cards from) or `worker:<id>` (another worker the owner
-- enrolled, in the same workspace). Never this worker itself: its own cards it starts locally.
create or replace function public.worker_new_card(p_key text, p_target text, p_folder text, p_payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
  v_kind text;
  v_id uuid;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 64000 then
    raise exception 'that card is too big or not a card' using errcode = '22023';
  end if;
  if p_folder is null or char_length(p_folder) not between 1 and 500 then
    raise exception 'that card names no folder' using errcode = '22023';
  end if;
  if p_target = 'worker:' || w.id::text then
    raise exception 'a worker starts its own cards itself' using errcode = '22023';
  elsif p_target like 'worker:%' then
    if not exists (select 1 from public.cloud_workers x
                   where 'worker:' || x.id::text = p_target and x.owner_user = w.owner_user and x.org_id = w.org_id) then
      raise exception 'that worker isn''t one of yours' using errcode = '42501';
    end if;
    v_kind := 'run';
  else
    if not exists (select 1 from public.cloud_cards c
                   where c.owner_device = p_target and c.owner_user = w.owner_user and c.org_id = w.org_id) then
      raise exception 'that Mac isn''t one of yours' using errcode = '42501';
    end if;
    v_kind := 'new_card';
  end if;
  insert into public.cloud_commands (org_id, created_by, kind, target_device, folder, payload)
    values (w.org_id, w.owner_user, v_kind, p_target, p_folder, p_payload)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.worker_new_card(text, text, text, jsonb) from public;
grant execute on function public.worker_new_card(text, text, text, jsonb) to anon, authenticated;

-- ─── The worker's crons and webhooks ─────────────────────────────────────────────
create table public.cloud_worker_lists (
  worker_id  uuid primary key references public.cloud_workers (id) on delete cascade,
  owner_user uuid not null references auth.users (id) on delete cascade,
  crons      jsonb not null default '[]'::jsonb check (jsonb_typeof(crons) = 'array'),
  webhooks   jsonb not null default '[]'::jsonb check (jsonb_typeof(webhooks) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.cloud_worker_lists enable row level security;
revoke all on public.cloud_worker_lists from anon, authenticated;

create policy "cloud_worker_lists: read own" on public.cloud_worker_lists
  for select to authenticated using ((select auth.uid()) = owner_user);
grant select on public.cloud_worker_lists to authenticated;

create or replace function public.worker_set_lists(p_key text, p_crons jsonb, p_webhooks jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  if jsonb_typeof(coalesce(p_crons, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_webhooks, '[]'::jsonb)) <> 'array' then
    raise exception 'those lists aren''t lists' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_crons, '[]'::jsonb)::text) > 256000 or octet_length(coalesce(p_webhooks, '[]'::jsonb)::text) > 256000 then
    raise exception 'those lists are too big' using errcode = '22023';
  end if;
  insert into public.cloud_worker_lists (worker_id, owner_user, crons, webhooks, updated_at)
    values (w.id, w.owner_user, coalesce(p_crons, '[]'::jsonb), coalesce(p_webhooks, '[]'::jsonb), now())
  on conflict (worker_id) do update
    set crons = excluded.crons, webhooks = excluded.webhooks, updated_at = now();
end;
$$;

revoke all on function public.worker_set_lists(text, jsonb, jsonb) from public;
grant execute on function public.worker_set_lists(text, jsonb, jsonb) to anon, authenticated;
