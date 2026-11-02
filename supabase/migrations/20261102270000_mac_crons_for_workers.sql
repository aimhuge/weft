-- A Mac's crons, listed read-only by a thread on one of the owner's Weft Workers (docs/architecture/crons.md#on-a-weft-worker).
-- A worker's list_crons used to list only the worker's own: a thread there couldn't see what the user had scheduled on
-- their Mac. Each Mac now publishes a summary of its crons (lib/mac-crons.ts) to cloud_mac_crons with its own session,
-- and the worker reads its owner's through worker_mac_crons(key).
--
-- What travels is what a list shows: id, name, schedule, fork or fresh, on or off, the next run and the project's name.
-- A prompt goes only when it's short (120 characters or fewer): a long one is the work itself, and a worker key is a
-- box's, not the user's. The function rebuilds every entry from those fields alone, so a Mac (or anyone holding the
-- session) that writes more still hands a worker no more. Nothing here lets a worker change a Mac's cron: a thread on a
-- worker is the less-trusted side, so that stays with the Mac's own window.

create table public.cloud_mac_crons (
  owner_user uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device     text not null check (char_length(device) between 1 and 100),
  label      text not null default '' check (char_length(label) <= 100),
  crons      jsonb not null default '[]'::jsonb check (jsonb_typeof(crons) = 'array' and octet_length(crons::text) <= 128000),
  updated_at timestamptz not null default now(),
  primary key (owner_user, device)
);

alter table public.cloud_mac_crons enable row level security;
revoke all on public.cloud_mac_crons from anon, authenticated;

create policy "cloud_mac_crons: read own" on public.cloud_mac_crons
  for select to authenticated using ((select auth.uid()) = owner_user);
create policy "cloud_mac_crons: insert own" on public.cloud_mac_crons
  for insert to authenticated with check ((select auth.uid()) = owner_user);
create policy "cloud_mac_crons: update own" on public.cloud_mac_crons
  for update to authenticated using ((select auth.uid()) = owner_user) with check ((select auth.uid()) = owner_user);
create policy "cloud_mac_crons: delete own" on public.cloud_mac_crons
  for delete to authenticated using ((select auth.uid()) = owner_user);
grant select, insert, update, delete on public.cloud_mac_crons to authenticated;

create or replace function public.worker_mac_crons(p_key text)
returns table (device text, label text, crons jsonb, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.cloud_workers := private.worker_for_key(p_key);
begin
  return query
    select m.device, m.label,
           coalesce((
             select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                      'id', e->'id', 'name', e->'name', 'expr', e->'expr', 'mode', e->'mode', 'enabled', e->'enabled',
                      -- The project's name only: a path a Mac wrote anyway is cut to its last part.
                      'folder', case when jsonb_typeof(e->'folder') = 'string' then to_jsonb(left(regexp_replace(e->>'folder', '^.*/', ''), 100)) end,
                      'nextAt', e->'nextAt',
                      'prompt', case when jsonb_typeof(e->'prompt') = 'string' and char_length(e->>'prompt') <= 120 then e->'prompt' end)))
             from jsonb_array_elements(m.crons) e
             where jsonb_typeof(e) = 'object'
           ), '[]'::jsonb),
           m.updated_at
    from public.cloud_mac_crons m
    where m.owner_user = w.owner_user
    order by m.updated_at desc
    limit 20;
end;
$$;

revoke all on function public.worker_mac_crons(text) from public;
grant execute on function public.worker_mac_crons(text) to anon, authenticated;
