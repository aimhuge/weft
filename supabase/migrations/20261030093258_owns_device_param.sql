-- desktop_workers (20261029141006) added a `device` column to cloud_workers, and in this function's second branch a
-- bare `device` resolves to that column before the parameter. The test became 'worker:' || w.id = w.device, never true
-- for a headless worker, so RLS refused every command to a worker with no cards yet, its first run and sign-ins
-- included. Qualifying the parameter restores what 20261029125616_weft_workers.sql says: a worker you enrolled.
create or replace function private.owns_device(device text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cloud_cards c
    where c.owner_device = owns_device.device and c.owner_user = (select auth.uid())
  ) or exists (
    select 1 from public.cloud_workers w
    where 'worker:' || w.id::text = owns_device.device and w.owner_user = (select auth.uid())
  );
$$;
