-- The desktop calls share_vault and share_vault_recovery with supabase-js's rpc(), which reaches the
-- public schema only, and both functions live in private, so neither could ever be called. These are
-- thin wrappers: they run as the caller, and every check stays in the private function. The functions
-- themselves stay in private because they are security definer.

create or replace function public.share_vault(
  p_org_id      uuid,
  p_repo        text,
  p_label       text,
  p_device_id   uuid,
  p_wrapped_key text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.share_vault(p_org_id, p_repo, p_label, p_device_id, p_wrapped_key);
$$;

revoke all on function public.share_vault(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.share_vault(uuid, text, text, uuid, text) to authenticated;

create or replace function public.share_vault_recovery(
  p_vault_id    uuid,
  p_public_key  text,
  p_wrapped_key text,
  p_key_version integer
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.share_vault_recovery(p_vault_id, p_public_key, p_wrapped_key, p_key_version);
$$;

revoke all on function public.share_vault_recovery(uuid, text, text, integer) from public, anon;
grant execute on function public.share_vault_recovery(uuid, text, text, integer) to authenticated;
