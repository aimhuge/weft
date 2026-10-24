-- Limit records: the Fastest Burn leaderboard. Each signed-in Mac posts, beside its league week (lib/limit-board-sync.ts),
-- how fast it ever burned a 5-hour and a weekly plan window (from window open to the limit hit) and how many of each it
-- has run dry. Never prompts, code or project names. docs/architecture/gamification.md#limit-records.

create table public.limit_records (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  -- Fastest burn of each window in ms, and when; null until a burn with a known reset.
  five_hour_ms   integer check (five_hour_ms between 60000 and 18000000),
  five_hour_at   timestamptz,
  seven_day_ms   integer check (seven_day_ms between 60000 and 604800000),
  seven_day_at   timestamptz,
  five_hour_hits integer not null default 0 check (five_hour_hits between 0 and 100000),
  seven_day_hits integer not null default 0 check (seven_day_hits between 0 and 10000),
  updated_at     timestamptz not null default now()
);

create index limit_records_five_hour on public.limit_records (five_hour_ms) where five_hour_ms is not null;
create index limit_records_seven_day on public.limit_records (seven_day_ms) where seven_day_ms is not null;

-- No policies: reads and writes go through the functions below, which only ever act as the caller.
alter table public.limit_records enable row level security;

-- The Mac's post. A burn outside its window's bounds (or with no date) is dropped rather than clamped, so a bad
-- reading can't take first place.
create or replace function public.limit_submit(
  p_five_ms integer, p_five_at timestamptz, p_week_ms integer, p_week_at timestamptz, p_five_hits integer, p_week_hits integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  five_ok boolean := p_five_ms between 60000 and 18000000 and p_five_at is not null and p_five_at <= now() + interval '1 hour';
  week_ok boolean := p_week_ms between 60000 and 604800000 and p_week_at is not null and p_week_at <= now() + interval '1 hour';
begin
  if me is null then
    raise exception 'Sign in to Weft to post your limit records.';
  end if;
  insert into public.limit_records as r (user_id, five_hour_ms, five_hour_at, seven_day_ms, seven_day_at, five_hour_hits, seven_day_hits)
  values (
    me,
    case when five_ok then p_five_ms end, case when five_ok then p_five_at end,
    case when week_ok then p_week_ms end, case when week_ok then p_week_at end,
    least(greatest(coalesce(p_five_hits, 0), 0), 100000),
    least(greatest(coalesce(p_week_hits, 0), 0), 10000)
  )
  on conflict (user_id) do update set
    five_hour_ms = excluded.five_hour_ms,
    five_hour_at = excluded.five_hour_at,
    seven_day_ms = excluded.seven_day_ms,
    seven_day_at = excluded.seven_day_at,
    five_hour_hits = excluded.five_hour_hits,
    seven_day_hits = excluded.seven_day_hits,
    updated_at = now();
end;
$$;

-- One board, best first: the top 50 plus the caller's own row. p_board is five_hour or seven_day (fastest burn, lowest
-- first) or five_hour_hits or seven_day_hits (most windows run dry). Names come from profiles as in league_standings.
create or replace function public.limit_board(p_board text)
returns table (rank integer, user_id uuid, name text, avatar_url text, username text, value bigint, at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with scored as (
    select r.user_id,
      case p_board
        when 'five_hour' then r.five_hour_ms::bigint
        when 'seven_day' then r.seven_day_ms::bigint
        when 'five_hour_hits' then nullif(r.five_hour_hits, 0)::bigint
        when 'seven_day_hits' then nullif(r.seven_day_hits, 0)::bigint
      end as value,
      case p_board when 'five_hour' then r.five_hour_at when 'seven_day' then r.seven_day_at end as at
    from public.limit_records r
  ), ranked as (
    select s.*, (rank() over (order by case when p_board like '%_hits' then -s.value else s.value end))::integer as rank
    from scored s where s.value is not null
  )
  select
    k.rank,
    k.user_id,
    coalesce(nullif(p.display_name, ''), nullif(p.name, ''), 'Builder'),
    p.avatar_url,
    coalesce(to_jsonb(p)->>'username', u.raw_user_meta_data->>'user_name'),
    k.value,
    k.at,
    k.user_id = auth.uid()
  from ranked k
  left join public.profiles p on p.id = k.user_id
  left join auth.users u on u.id = k.user_id
  where k.rank <= 50 or k.user_id = auth.uid()
  order by k.rank, 3;
$$;

revoke all on function public.limit_submit(integer, timestamptz, integer, timestamptz, integer, integer) from public, anon;
revoke all on function public.limit_board(text) from public, anon;
grant execute on function public.limit_submit(integer, timestamptz, integer, timestamptz, integer, integer) to authenticated;
grant execute on function public.limit_board(text) to authenticated;
