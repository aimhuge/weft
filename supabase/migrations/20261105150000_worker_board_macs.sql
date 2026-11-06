-- The owner's Macs by name, for a thread on a Weft Worker (docs/architecture/project-hosts.md#board-tools-on-a-worker).
-- create_card on a worker found a Mac project by its folder alone, so two Macs that both hold /Users/me/dev/weft were one
-- ambiguity nothing could settle. A thread now names one as mac://<Mac>/<path>, the Mac by the name it already beats
-- with (desktop_worker_beat, its host name: what Settings → Sync → Workers shows the workspace) or by its device id.
--
-- Only the device id (already in every cloud_cards row worker_board_cards returns) and that name travel: no platform,
-- status, keys or last-seen. The owner's own Macs in the worker's workspace, not revoked.
create or replace function public.worker_board_macs(p_key text)
returns table (device text, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  return query
    select d.device, d.name
    from public.cloud_workers d
    where d.kind = 'desktop' and d.owner_user = w.owner_user and d.org_id = w.org_id
      and d.device is not null and d.revoked_at is null
    order by d.last_seen_at desc nulls last
    limit 20;
end;
$$;

revoke all on function public.worker_board_macs(text) from public;
grant execute on function public.worker_board_macs(text) to anon, authenticated;

-- ─── A card for a Mac with no cards yet ─────────────────────────────────────────
-- worker_new_card took a Mac only when it had synced cards, so mac://<Mac>/<path> to a Mac that beats here but has
-- none was refused. It now takes the Mac worker_board_macs lists too, and refuses one the user revoked. The rest is
-- 20261102210000_worker_board_tools.sql's, unchanged.
-- p_target is a Mac's device id (one with synced cards, or beating here) or `worker:<id>` (another worker the owner
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
  v_payload jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 64000
     or jsonb_typeof(p_payload->'prompt') is distinct from 'string' or char_length(btrim(p_payload->>'prompt')) = 0 then
    raise exception 'that card is too big or not a card' using errcode = '22023';
  end if;
  -- What a card from a worker may carry, and nothing else: no mode, agent, model, repo, schedule or attachments.
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'prompt', p_payload->'prompt',
    'title', case when jsonb_typeof(p_payload->'title') = 'string' then p_payload->'title' end,
    'tags', case when jsonb_typeof(p_payload->'tags') = 'array' then p_payload->'tags' end,
    'start', case when p_payload->'start' = 'false'::jsonb then p_payload->'start' end,
    'fromWorker', w.id::text));
  if (select count(*) from public.cloud_commands c
      where c.org_id = w.org_id and c.created_at > now() - interval '1 hour'
        and c.payload->>'fromWorker' = w.id::text) >= 30 then
    raise exception 'this worker has sent 30 cards in the last hour; wait, or start them from the board' using errcode = '54000';
  end if;
  if p_folder is null or char_length(p_folder) not between 1 and 500 then
    raise exception 'that card names no folder' using errcode = '22023';
  end if;
  if p_target = 'worker:' || w.id::text then
    raise exception 'a worker starts its own cards itself' using errcode = '22023';
  elsif p_target like 'worker:%' then
    if not exists (select 1 from public.cloud_workers x
                   where 'worker:' || x.id::text = p_target and x.owner_user = w.owner_user and x.org_id = w.org_id
                     and x.kind = 'headless' and x.revoked_at is null) then
      raise exception 'that worker isn''t one of yours' using errcode = '42501';
    end if;
    v_kind := 'run';
  else
    -- One of the owner's Macs in this workspace: one with synced cards, or one beating here with no cards yet (what
    -- worker_board_macs lists). Never a Mac whose host row the user revoked.
    if exists (select 1 from public.cloud_workers d
               where d.kind = 'desktop' and d.device = p_target and d.owner_user = w.owner_user and d.revoked_at is not null) then
      raise exception 'that Mac was removed from your account' using errcode = '42501';
    end if;
    if not exists (select 1 from public.cloud_cards c
                   where c.owner_device = p_target and c.owner_user = w.owner_user and c.org_id = w.org_id)
       and not exists (select 1 from public.cloud_workers d
                       where d.kind = 'desktop' and d.device = p_target and d.owner_user = w.owner_user and d.org_id = w.org_id
                         and d.revoked_at is null) then
      raise exception 'that Mac isn''t one of yours' using errcode = '42501';
    end if;
    v_kind := 'new_card';
  end if;
  insert into public.cloud_commands (org_id, created_by, kind, target_device, folder, payload)
    values (w.org_id, w.owner_user, v_kind, p_target, p_folder, v_payload)
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.worker_new_card(text, text, text, jsonb) from public;
grant execute on function public.worker_new_card(text, text, text, jsonb) to anon, authenticated;
