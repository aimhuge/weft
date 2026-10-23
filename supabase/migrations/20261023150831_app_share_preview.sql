-- A shared mini app's link preview (lib/app-preview.ts): the title, description and picture weft.zip puts in the
-- page's Open Graph tags. The sharer's Mac writes it after each share (lib/app-preview-capture.ts); weft.zip reads it
-- through the service role, and only for public links. Small by design: text at its caps and blob refs, never bytes.
alter table public.cloud_app_shares
  add column preview jsonb
  check (preview is null or (jsonb_typeof(preview) = 'object' and pg_column_size(preview) <= 4096));

-- The sharer reads and writes it like the row's other columns (RLS already limits writes to their own rows).
grant select (preview) on public.cloud_app_shares to authenticated;
grant insert (preview) on public.cloud_app_shares to authenticated;
grant update (preview) on public.cloud_app_shares to authenticated;
