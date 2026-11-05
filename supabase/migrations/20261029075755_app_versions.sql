-- Which version of Weft everyone is on (docs/architecture/growth.md).
--
-- Nothing recorded it before: the updater reads update.json straight from GitHub, and every session's user agent is
-- just "node". So the signed-in Mac reports its own version once a day (lib/app-version-sync.ts) through
-- app_version_submit, as the caller only, and 📈 Growth reads it back with growth_versions.
--
-- One row per account, version and channel: a release build (the .dmg) or dev mode (`pnpm desktop` from a git checkout,
-- whose version is package.json's and may run ahead of the latest release). An account's current version is the one it
-- reported most recently.

create table public.app_versions (
  user_id  uuid not null references auth.users (id) on delete cascade,
  version  text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' and char_length(version) <= 40),
  channel  text not null check (channel in ('release', 'dev')),
  platform text not null check (platform in ('darwin', 'linux', 'win32')),
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),
  primary key (user_id, version, channel)
);

create index app_versions_last on public.app_versions (user_id, last_at desc);

comment on table public.app_versions is
  'The Weft versions each account has run, reported by the signed-in Mac once a day. Service role reads; the Mac writes through app_version_submit.';

-- No policies: the Mac writes through app_version_submit (as the caller only) and Growth reads with the service role.
alter table public.app_versions enable row level security;
revoke all on public.app_versions from anon, authenticated;

create or replace function public.app_version_submit(p_version text, p_channel text, p_platform text)
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
  insert into public.app_versions (user_id, version, channel, platform)
  values (me, p_version, p_channel, p_platform)
  on conflict (user_id, version, channel) do update
    set last_at = now(), platform = excluded.platform;
end;
$$;

revoke all on function public.app_version_submit(text, text, text) from public, anon;
grant execute on function public.app_version_submit(text, text, text) to authenticated;

-- Accounts per version, each counted once at the version it reported last. `active_7d` is the accounts among them that
-- reported in the last week, so a version nobody has opened in a while reads as fading, not as current. Newest first,
-- by the version's numbers (0.10.0 after 0.9.0, a prerelease before its release).
create or replace function public.growth_versions(days int default 90)
returns table (version text, channel text, accounts bigint, active_7d bigint, first_at timestamptz, last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (v.user_id) v.user_id, v.version, v.channel, v.last_at
      from public.app_versions v
     where v.last_at >= now() - make_interval(days => greatest(days, 1))
     order by v.user_id, v.last_at desc
  ),
  seen as (
    select v.version, v.channel, min(v.first_at) as first_at
      from public.app_versions v
     group by v.version, v.channel
  )
  select l.version,
         l.channel,
         count(*),
         count(*) filter (where l.last_at >= now() - interval '7 days'),
         s.first_at,
         max(l.last_at)
    from latest l
    join seen s on s.version = l.version and s.channel = l.channel
   group by l.version, l.channel, s.first_at
   order by string_to_array(split_part(l.version, '-', 1), '.')::int[] desc,
            (split_part(l.version, '-', 2) = '') desc,
            split_part(l.version, '-', 2) desc,
            l.channel;
$$;

revoke all on function public.growth_versions(int) from public, anon, authenticated;
grant execute on function public.growth_versions(int) to service_role;
