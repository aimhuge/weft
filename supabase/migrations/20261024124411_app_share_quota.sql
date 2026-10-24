-- The plan gate on shared mini apps (docs/architecture/mini-app-hosting.md "Access, plans and limits", billing.md):
-- views stay unlimited on every plan, but the bytes a workspace's open links serve are capped by its plan. The
-- Mac checks first so the Share dialog can say why (lib/app-share-quota.ts), and this trigger is the gate itself,
-- so a client writing rows straight through PostgREST can't skip it.
--
-- A row's bytes are measured here, from the blobs its page and files name in weft-blobs (storage.objects keeps each
-- object's size), never taken from the client. Only links someone can open count: a private link costs no views,
-- so making one private frees its room. Site links (an https address) store nothing and count 0.
--
-- The numbers mirror APP_SHARE_BYTES in lib/billing/plans.ts; lib/app-share-quota.test.ts reads this file to keep
-- them in step.

alter table public.cloud_app_shares add column if not exists bytes bigint not null default 0;
grant select (bytes) on public.cloud_app_shares to authenticated;

-- The plan a workspace is on, the way lib/billing/plan-gate.ts workspacePlan reads it: no row, a subscription
-- that isn't active or trialing, a lapsed Open Source / Education grant, or an unknown id all read as free.
create or replace function private.org_plan(org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.plan from public.org_subscriptions s
    where s.org_id = org
      and (coalesce(s.status, '') = '' or s.status in ('active', 'trialing'))
      and s.plan in ('free', 'oss', 'edu', 'pro', 'team')
      and (s.plan not in ('oss', 'edu') or (s.trial_end is not null and s.trial_end > now()))
  ), 'free');
$$;

-- Bytes a plan's open links may serve in total, per workspace.
create or replace function private.app_share_byte_limit(plan text) returns bigint
language sql immutable set search_path = '' as $$
  select case plan
    when 'pro' then 1073741824::bigint
    when 'oss' then 1073741824::bigint
    when 'edu' then 1073741824::bigint
    when 'team' then 5368709120::bigint
    else 26214400::bigint
  end;
$$;

-- What one share's blobs weigh: the blob's sha for a single page, every value of the files map for a folder.
create or replace function private.app_share_bytes(org uuid, kind text, page text, files jsonb) returns bigint
language sql stable security definer set search_path = '' as $$
  with shas as (
    select substring(page from '^blob:sha256:([0-9a-f]{64})') as sha where kind = 'blob'
    union
    select v from jsonb_each_text(coalesce(files, '{}'::jsonb)) as f(k, v) where kind = 'folder'
  )
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o
  join shas on o.name = org::text || '/' || shas.sha
  where o.bucket_id = 'weft-blobs';
$$;

-- Before a row is written: weigh it, and refuse it when the workspace's open links would pass the plan's cap.
-- A row going private, or one that weighs nothing, always passes. The message starts with app_share_quota: so
-- lib/app-share.ts can turn it into the dialog's wording.
create or replace function private.cloud_app_shares_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  used bigint;
  cap bigint;
  plan text;
begin
  new.bytes := private.app_share_bytes(new.org_id, new.kind, new.page, new.files);
  if new.mode = 'private' or new.bytes = 0 then return new; end if;
  select coalesce(sum(s.bytes), 0) into used from public.cloud_app_shares s
    where s.org_id = new.org_id and s.mode <> 'private' and s.id <> new.id;
  plan := private.org_plan(new.org_id);
  cap := private.app_share_byte_limit(plan);
  if used + new.bytes > cap then
    raise exception 'app_share_quota: % of % bytes on the % plan', used + new.bytes, cap, plan
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists cloud_app_shares_quota on public.cloud_app_shares;
create trigger cloud_app_shares_quota
  before insert or update of org_id, kind, page, files, mode on public.cloud_app_shares
  for each row execute function private.cloud_app_shares_quota();

-- What the Share dialog shows: the workspace's plan, the bytes its open links use and the cap. Members only.
-- except_share leaves one link out of `used`, so the Mac can ask "would this link, at its new size, fit?".
create or replace function public.app_share_quota(org uuid, except_share text default null)
returns table (plan text, used bigint, cap bigint)
language sql stable security definer set search_path = '' as $$
  select p.plan,
    (select coalesce(sum(s.bytes), 0)::bigint from public.cloud_app_shares s
      where s.org_id = org and s.mode <> 'private' and s.id is distinct from except_share),
    private.app_share_byte_limit(p.plan)
  from (select private.org_plan(org) as plan) p
  where private.is_org_member(org);
$$;

revoke all on function public.app_share_quota(uuid, text) from public, anon;
grant execute on function public.app_share_quota(uuid, text) to authenticated;
revoke all on function private.org_plan(uuid), private.app_share_bytes(uuid, text, text, jsonb),
  private.cloud_app_shares_quota() from public, anon, authenticated;

-- Weigh the rows that are already there, so the first write after this one sees real numbers.
update public.cloud_app_shares set bytes = private.app_share_bytes(org_id, kind, page, files);
