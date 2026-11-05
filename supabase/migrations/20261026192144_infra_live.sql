-- The live infrastructure numbers behind the repo-analysis report's "Infrastructure & quotas" section
-- (docs/architecture/repo-analysis.md).
--
-- One read-only function, `public.infra_live()`, that measures what the Postgres side can measure: the database
-- size, the file storage behind the `weft-blobs` bucket, the table count, the auth users, and the growth of
-- the cloud sync tables. The report calls it through PostgREST (`GET /rest/v1/rpc/infra_live`) with the
-- production SUPABASE_SECRET_KEY, the same way the Growth data app reads `growth_overview`
-- (supabase/migrations/20261018054110_growth_reads.sql).
--
-- Egress is NOT here: it lives in Supabase's log stream, not in a table, so it is read by the Mac over the
-- Analytics API (lib/infra-live.ts) and never from the database. The numbers this function returns are what
-- the report cannot get any other way — everything here would need a dashboard login otherwise.
--
-- Like the Growth reads, this one is for the service role alone: functions get EXECUTE for PUBLIC by default
-- and Supabase grants anon and authenticated on new public functions, so each one is revoked from all three
-- and granted to service_role alone. A signed-in key can't call it.

-- The project's own infrastructure, as one JSON object.
--
--   database_bytes      the whole database on disk
--   public_bytes        the public schema's tables and indexes
--   table_count         the tables in the public schema
--   total_tables        every table in the database, the auth and storage schemas included
--   storage_bytes       the bytes in the file storage bucket
--   storage_objects     the objects in it
--   storage_bucket      the bucket's name
--   storage_24h_bytes   the bytes uploaded in the last day, and the objects
--   auth_users          the accounts
--   auth_24h            the accounts that signed in in the last day
--   cloud_cards         the synced cards, and the ones not deleted
--   thread_items        the synced thread items, and how many in the last day
--   share_links         the share links, and how many visits
--   oldest_card         the oldest synced card, so a reader can see how long the cloud has been running
create or replace function public.infra_live()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bucket as (
    select b.id, b.name from storage.buckets b order by b.created_at limit 1
  ),
  objects as (
    select
      count(*)::int as n,
      coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint as bytes
      from storage.objects o
     where o.bucket_id = (select id from bucket)
  ),
  recent as (
    select
      count(*)::int as n,
      coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint as bytes
      from storage.objects o
     where o.bucket_id = (select id from bucket)
       and o.created_at > now() - interval '24 hours'
  ),
  tables as (
    select
      count(*) filter (where n.nspname = 'public')::int as public_tables,
      count(*)::int as all_tables
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')
  )
  select jsonb_build_object(
    'database_bytes',  pg_database_size(current_database()),
    'public_bytes',    (select coalesce(sum(pg_total_relation_size(c.oid)), 0)
                           from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where c.relkind in ('r', 'p') and n.nspname = 'public'),
    'table_count',     (select public_tables from tables),
    'total_tables',    (select all_tables from tables),
    'storage_bytes',   (select bytes from objects),
    'storage_objects', (select n from objects),
    'storage_bucket',  (select name from bucket),
    'storage_24h_bytes',  (select bytes from recent),
    'storage_24h_objects',(select n from recent),
    'auth_users',      (select count(*)::int from auth.users),
    'auth_24h',        (select count(*)::int from auth.users where last_sign_in_at > now() - interval '24 hours'),
    'cloud_cards',     (select count(*)::int from public.cloud_cards),
    'cloud_cards_live',(select count(*)::int from public.cloud_cards where not deleted),
    'thread_items',    (select count(*)::int from public.cloud_thread_items),
    'thread_items_24h',(select count(*)::int from public.cloud_thread_items where at > now() - interval '24 hours'),
    'share_links',     (select count(*)::int from public.cloud_shares),
    'share_visits',    (select count(*)::int from public.cloud_share_visits),
    'oldest_card',     (select min(updated_at) from public.cloud_cards)
  );
$$;

revoke all on function public.infra_live() from public, anon, authenticated;
grant execute on function public.infra_live() to service_role;
