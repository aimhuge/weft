-- The R2 read copy of the weft-blobs bucket (docs/architecture/r2.md). Supabase Storage stays where blobs are
-- written (RLS "insert as org member"); the deployed Weft copies each object to Cloudflare R2 once
-- (lib/r2-mirror.ts) and records it here. Readers sign an R2 URL for a blob with a row here and fall back to a
-- Supabase signed URL for one without, so a blob that isn't copied yet still shows.
--
-- One row per copied object, keyed like the bucket: `<org_id>/<sha256>`. Content-addressed, so a row never
-- changes and is never stale. Members may read their org's rows: the web board asks "is this one copied?" with
-- the visitor's own session, so the select policy is also the membership check before an R2 URL is signed.
-- Writes are the service role's alone.

create table if not exists public.blob_mirror (
  org_id uuid not null,
  sha text not null check (sha ~ '^[0-9a-f]{64}$'),
  bytes bigint not null default 0,
  mirrored_at timestamptz not null default now(),
  primary key (org_id, sha)
);

alter table public.blob_mirror enable row level security;

create policy "blob_mirror: read as org member" on public.blob_mirror
  for select to authenticated
  using (private.is_org_member(org_id));

revoke insert, update, delete on public.blob_mirror from anon, authenticated;

-- The objects in weft-blobs with no row here yet, oldest first: what the mirror copies next.
create or replace function public.blob_mirror_pending(max_rows int default 100)
returns table (org_id uuid, sha text, bytes bigint, content_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (storage.foldername(o.name))[1]::uuid,
    split_part(o.name, '/', 2),
    coalesce((o.metadata ->> 'size')::bigint, 0),
    coalesce(o.metadata ->> 'mimetype', 'application/octet-stream')
    from storage.objects o
   where o.bucket_id = 'weft-blobs'
     and o.name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}$'
     and not exists (
       select 1 from public.blob_mirror m
        where m.org_id = (storage.foldername(o.name))[1]::uuid
          and m.sha = split_part(o.name, '/', 2)
     )
   order by o.created_at
   limit greatest(1, least(max_rows, 1000));
$$;

-- What the infra dashboard shows for R2 (lib/infra-live.ts): copied objects and bytes, and what's still only in
-- Supabase.
create or replace function public.blob_mirror_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mirrored as (
    select count(*)::int as n, coalesce(sum(bytes), 0)::bigint as b, max(mirrored_at) as last from public.blob_mirror
  ),
  total as (
    select count(*)::int as n, coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint as b
      from storage.objects o where o.bucket_id = 'weft-blobs'
  )
  select jsonb_build_object(
    'mirrored_objects', m.n,
    'mirrored_bytes', m.b,
    'pending_objects', greatest(t.n - m.n, 0),
    'pending_bytes', greatest(t.b - m.b, 0),
    'last_mirrored', m.last
  )
  from mirrored m, total t;
$$;

revoke all on function public.blob_mirror_pending(int), public.blob_mirror_stats() from public, anon, authenticated;
grant execute on function public.blob_mirror_pending(int), public.blob_mirror_stats() to service_role;
