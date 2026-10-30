-- New root folders under app/: /pair (device pairing) and /t (private tunnels). Same function as
-- 20261026145850_org_slug_reserved_roots.sql with both names added; lib/reserved-slugs.test.ts keeps it in step.
create or replace function private.org_slug_for(seed text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  base text := left(trim(both '-' from regexp_replace(lower(coalesce(seed, '')), '[^a-z0-9]+', '-', 'g')), 40);
  candidate text;
  n int := 1;
  reserved text[] := array[
    'a', 'about', 'account', 'admin', 'analytics', 'api', 'app', 'assets', 'auth', 'billing', 'blog', 'calendar',
    'cdn', 'channels', 'checkout', 'claim', 'clients', 'contact', 'copilot', 'dashboard', 'decks', 'docs', 'download',
    'faq', 'feedback', 'help', 'home', 'i', 'icon', 'internal', 'invite', 'leads', 'login', 'logout', 'mail', 'new',
    'o', 'opengraph-image', 'org', 'orgs', 'pair', 'posts', 'pricing', 'privacy', 'public', 's', 'schedule', 'settings',
    'signup', 'skills', 'static', 'status', 'support', 't', 'team', 'teams', 'terms', 'tokens', 'u', 'unsubscribe',
    'vault', 'w', 'workspace', 'workspaces', 'www'];
begin
  if base = '' then base := 'workspace'; end if;
  candidate := base;
  while length(candidate) < 2 or candidate = any(reserved) or exists (select 1 from public.orgs o where o.slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end;
$$;

revoke all on function private.org_slug_for(text) from public, anon, authenticated;
