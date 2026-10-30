-- The desktop as a headed worker (docs/architecture/weft-worker.md#the-desktop-as-a-headed-worker): a signed-in Weft
-- desktop that takes the web board's commands lists itself beside the headless workers, so a workspace sees every
-- box that can run its cards. It has no key: it's the account signed in, so it beats through desktop_worker_beat as
-- auth.uid(), one row per (account, device). Its commands keep going to its own device id, not `worker:<id>`.

alter table public.cloud_workers
  add column if not exists kind text not null default 'headless' check (kind in ('headless', 'desktop')),
  add column if not exists device text check (device is null or char_length(device) between 1 and 100);

-- A desktop row is one per account and device; a headless one has no device.
create unique index if not exists cloud_workers_desktop_device on public.cloud_workers (owner_user, device) where device is not null;

grant select (kind, device) on public.cloud_workers to authenticated;

-- The desktop's heartbeat: upserts its row in the workspace it syncs to and stamps it seen. key_hash gets a value
-- that is never a sha256 hex digest, so no key can ever act as a desktop row.
create or replace function public.desktop_worker_beat(p_org uuid, p_device text, p_name text, p_platform text, p_arch text, p_status text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  wid uuid;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if not private.is_org_member(p_org) then raise exception 'Not a member of that workspace.'; end if;
  if p_status not in ('online', 'busy') then raise exception 'Bad status.'; end if;
  insert into public.cloud_workers (org_id, owner_user, name, platform, arch, status, key_hash, last_seen_at, kind, device)
  values (p_org, uid, left(p_name, 80), p_platform, left(p_arch, 20), p_status, 'desktop:' || gen_random_uuid()::text, now(), 'desktop', p_device)
  on conflict (owner_user, device) where device is not null do update
    set org_id = excluded.org_id, name = excluded.name, platform = excluded.platform, arch = excluded.arch,
        status = excluded.status, last_seen_at = now()
  returning id into wid;
  return wid;
end;
$$;

revoke all on function public.desktop_worker_beat(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.desktop_worker_beat(uuid, text, text, text, text, text) to authenticated;
