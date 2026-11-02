-- Two upkeep jobs for the Weft Worker (docs/architecture/weft-worker.md#liveness and #expiring-commands).
--
-- 1. Liveness as Realtime Presence. A worker used to write its row every 20 s (~4,300 writes a day each). Now it
--    tracks itself on a Presence topic and writes the row every 5 minutes, or when its status changes, or every 20 s
--    while its socket is down. The worker has no session, so the channel is public and the topic is the secret, as
--    with the wake topic (20261030072445_worker_wake.sql): it's derived from key_hash, which no client can read. The
--    worker computes it from its key; the owner's boards ask for it through worker_presence_topics, which only hands
--    a signed-in user the topics of the headless workers they enrolled, in a workspace they're still a member of. A leaked topic lets someone see when that
--    worker is up, or show it online when it isn't. Never a command: those are still read through worker_pending.
--
-- 2. Finished cloud_commands expire. Rows used to stay forever. expire_cloud_commands deletes done and failed rows after
--    a day (a failed clone after 7, so Settings → Sync → Workers keeps showing why), claimed rows after 7 days (a Mac or
--    worker that crashed mid-command leaves them claimed for good), and never a pending one. pg_cron runs it daily
--    where pg_cron was installed when this migration ran.

-- ─── Presence ────────────────────────────────────────────────────────────────
-- Must match lib/worker-presence.ts presenceTopic, which starts from sha256 of the key.
create or replace function private.worker_presence_topic(p_key_hash text)
returns text
language sql
immutable
set search_path = ''
as $$ select 'worker-presence:' || private.sha256_hex('weft-worker-presence:' || p_key_hash); $$;

revoke all on function private.worker_presence_topic(text) from public, anon, authenticated;

-- Definer, because the caller can't read key_hash. Only your own headless workers, in a workspace you're still in: a
-- teammate's falls back to its row, and so does one left behind in a workspace you've left.
create or replace function public.worker_presence_topics()
returns table (worker_id uuid, topic text)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, private.worker_presence_topic(w.key_hash)
    from public.cloud_workers w
    where w.owner_user = (select auth.uid()) and w.kind = 'headless' and w.key_hash is not null
      and exists (select 1 from public.org_memberships m where m.org_id = w.org_id and m.user_id = (select auth.uid()));
$$;

revoke all on function public.worker_presence_topics() from public, anon;
grant execute on function public.worker_presence_topics() to authenticated;

-- ─── Expiring finished commands ──────────────────────────────────────────────
-- updated_at is when it was claimed or reported (cloud_commands_touch_updated_at). The partial index covers every row
-- the delete can take, so the daily run never scans the pending queue or the whole table.
create index if not exists cloud_commands_expirable
  on public.cloud_commands (updated_at)
  where status in ('done', 'failed', 'claimed');

create or replace function private.expire_cloud_commands()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone integer;
begin
  delete from public.cloud_commands
    where status in ('done', 'failed', 'claimed')
      -- The shortest age, so the index scans a range; the case then holds the 7-day rows back.
      and updated_at < now() - interval '1 day'
      and updated_at < now() - case
        when status = 'claimed' then interval '7 days'
        when status = 'failed' and kind = 'clone' then interval '7 days'
        else interval '1 day'
      end;
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke all on function private.expire_cloud_commands() from public, anon, authenticated;

-- No other migration uses pg_cron, so this doesn't install it. Where it's already there, this schedules the job at
-- 04:17 UTC daily. Where it isn't, this does nothing, and a migration never runs twice: a project that turns on pg_cron
-- later (Dashboard → Integrations → Cron) schedules it once by hand, in the SQL editor:
--   select cron.schedule('expire-cloud-commands', '17 4 * * *', 'select private.expire_cloud_commands()');
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expire-cloud-commands', '17 4 * * *', 'select private.expire_cloud_commands()');
  end if;
end;
$$;
