-- The mode a thread started from weft.zip starts in on this Mac when the form names none (docs/architecture/new-card-parity.md):
-- the Mac's own default held to its web rule (lib/cloud-new-card-mode.ts). The Mac publishes it beside its desktop-worker
-- beat, into the row's `capabilities` (members can already read it), so the New thread dialog opens on the mode the
-- thread will really start in. Only the row's owner, only a desktop row of theirs, and only a mode a web card may start in.
create or replace function public.desktop_worker_start_mode(p_device text, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_mode not in ('default', 'acceptEdits', 'auto') then raise exception 'Bad mode.'; end if;
  update public.cloud_workers
     set capabilities = capabilities || jsonb_build_object('startMode', p_mode)
   where owner_user = uid and device = p_device and kind = 'desktop';
end;
$$;

revoke all on function public.desktop_worker_start_mode(text, text) from public, anon;
grant execute on function public.desktop_worker_start_mode(text, text) to authenticated;
