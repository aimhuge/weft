-- Workspace slugs live at the URL root (/<slug>/board), so a slug that matches one of Weft's root folders under app/
-- (privacy, terms, faq, checkout, s, u, w...) would 404 behind the static page. This redefines org_slug_for with the
-- full list from lib/reserved-slugs.ts: @aimhuge/teams' RESERVED_SLUGS plus lib/app-routes.ts allReserved().
-- lib/reserved-slugs.test.ts checks this array matches that list, so keep them in step (sorted, one per name).
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
    'o', 'opengraph-image', 'org', 'orgs', 'posts', 'pricing', 'privacy', 'public', 's', 'schedule', 'settings',
    'signup', 'skills', 'static', 'status', 'support', 'team', 'teams', 'terms', 'tokens', 'u', 'unsubscribe',
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
