-- Which Weft version every device runs (docs/architecture/device-registry.md#versions).
--
-- A worker already publishes cloud_workers.build ("0.6.7+abc1234", worker_set_build). A Mac now writes the same string
-- on its own heartbeat row once a day, from lib/app-version-sync.ts, through desktop_set_build, with the channel
-- (release or dev). Settings → Devices reads it back through device_registry, and the admin Users page reads every
-- account's through admin_device_versions. app_versions gains the commit too, so Growth can tell two builds of one
-- version apart. Phones and browsers report nothing, so their build stays null.

alter table public.cloud_workers
  add column if not exists build_channel text check (build_channel is null or build_channel in ('release', 'dev'));
grant select (build_channel) on public.cloud_workers to authenticated;

alter table public.app_versions
  add column if not exists commit text check (commit is null or commit ~ '^[0-9a-f]{7,40}$');

-- The caller's own Mac only: its heartbeat row (kind desktop, device = the Mac's device id). False when the Mac has no
-- row yet (its first beat hasn't landed), so the Mac asks again on the next tick.
create or replace function public.desktop_set_build(p_device text, p_build text, p_channel text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  n int;
begin
  if me is null then
    raise exception 'Sign in to Weft to report its version.';
  end if;
  if p_channel is null or p_channel not in ('release', 'dev') then
    raise exception 'Unknown channel.';
  end if;
  update public.cloud_workers
     set build = left(p_build, 60), build_channel = p_channel
   where owner_user = me and kind = 'desktop' and device = p_device and revoked_at is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.desktop_set_build(text, text, text) from public, anon;
grant execute on function public.desktop_set_build(text, text, text) to authenticated;

-- app_version_submit with the commit. The three-argument form is replaced by one function whose p_commit defaults to
-- null, not kept as an overload: with both, a three-argument call (an installed 0.6.x Mac, by position or by named
-- args through PostgREST) matches both and fails as ambiguous. This way the old call shape still resolves, and a null
-- never overwrites a commit already recorded. (Checked on a scratch Postgres: 3 positional, 3 named, 4 named.)
drop function if exists public.app_version_submit(text, text, text);
create or replace function public.app_version_submit(p_version text, p_channel text, p_platform text, p_commit text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in to Weft to report its version.';
  end if;
  insert into public.app_versions (user_id, version, channel, platform, commit)
  values (me, p_version, p_channel, p_platform, p_commit)
  on conflict (user_id, version, channel) do update
    set last_at = now(), platform = excluded.platform, commit = coalesce(excluded.commit, public.app_versions.commit);
end;
$$;

revoke all on function public.app_version_submit(text, text, text, text) from public, anon;
grant execute on function public.app_version_submit(text, text, text, text) to authenticated;

-- device_registry with a build column at the end (a Mac's from its heartbeat row, a worker's own).
create or replace view public.device_registry
with (security_invoker = true) as
  select d.id,
         case d.kind when 'desktop' then 'mac' else d.kind end as kind,
         d.name,
         d.platform,
         d.user_id as owner_user,
         coalesce(w.org_id, p.org_id) as org_id,
         d.public_key as box_key,
         d.sign_key,
         d.passkey_id,
         d.passkey_key,
         d.fingerprint,
         coalesce(w.device, d.host_device) as host,
         d.id as key_device,
         w.id as worker_id,
         w.status,
         greatest(d.last_seen_at, w.last_seen_at) as last_seen_at,
         coalesce(d.revoked_at, w.revoked_at) as revoked_at,
         d.created_at,
         w.build,
         w.build_channel
    from public.devices d
    left join lateral (
      select cw.id, cw.org_id, cw.device, cw.status, cw.last_seen_at, cw.revoked_at, cw.build, cw.build_channel
        from public.cloud_workers cw
       where d.kind = 'desktop' and cw.kind = 'desktop' and cw.owner_user = d.user_id and cw.device = d.host_device
       order by cw.last_seen_at desc nulls last
       limit 1
    ) w on true
    left join lateral (
      select pp.org_id
        from public.phone_pairings pp
       where pp.device_id = d.id and pp.status = 'paired'
       order by pp.created_at desc
       limit 1
    ) p on true
   where d.user_id is not null
  union all
  select cw.id,
         case cw.kind when 'desktop' then 'mac' else 'worker' end,
         cw.name,
         cw.platform,
         cw.owner_user,
         cw.org_id,
         cw.public_key,
         cw.sign_key,
         null::text,
         null::text,
         null::text,
         case cw.kind when 'desktop' then cw.device else 'worker:' || cw.id::text end,
         null::uuid,
         cw.id,
         cw.status,
         cw.last_seen_at,
         cw.revoked_at,
         cw.created_at,
         cw.build,
         cw.build_channel
    from public.cloud_workers cw
   where cw.kind = 'headless'
      or not exists (
        select 1 from public.devices d
         where d.kind = 'desktop' and d.user_id = cw.owner_user and d.host_device = cw.device
      );

revoke all on public.device_registry from public, anon, authenticated;
grant select on public.device_registry to authenticated;

-- Every live Mac and worker's build, for the admin Users page (service role only).
create or replace function public.admin_device_versions()
returns table (user_id uuid, kind text, name text, build text, channel text, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select cw.owner_user, case cw.kind when 'desktop' then 'mac' else 'worker' end, cw.name, cw.build, cw.build_channel, cw.last_seen_at
    from public.cloud_workers cw
   where cw.revoked_at is null and cw.build is not null and cw.owner_user is not null;
$$;

revoke all on function public.admin_device_versions() from public, anon, authenticated;
grant execute on function public.admin_device_versions() to service_role;
