-- Sharing a card with anyone on GitHub (docs/architecture/sharing.md#people): the card's owner names a GitHub
-- account, from the Share dialog or by @mentioning it in the thread, and that person gets in to the share link
-- after signing in to weft.zip with GitHub, whatever the link's mode, with no workspace membership.
-- Keyed by GitHub's numeric id, never the login: logins get renamed and re-registered by strangers.
-- The owner's Mac writes rows through the signed-in account; the deployed Weft reads them with the service role
-- in the gate (share_grant_admits) and stamps notified_at / opened_at. lib/share-grant-types.ts is the contract.
create table public.cloud_share_grants (
  share_id     text not null references public.cloud_shares (id) on delete cascade,
  github_id    bigint not null check (github_id > 0),
  github_login text not null check (github_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'),
  -- How the owner named them: the Share dialog's People field, or an @mention they agreed to on send.
  via          text not null default 'share' check (via in ('share', 'mention')),
  granted_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- Written by the deployed Weft only (service role): when the invite email went out, and when they first got in.
  notified_at  timestamptz,
  opened_at    timestamptz,
  primary key (share_id, github_id)
);

alter table public.cloud_share_grants enable row level security;
revoke all on public.cloud_share_grants from anon, authenticated;

-- Only the shared card's owner sees, adds or removes who it's shared with: the names are theirs, not the
-- workspace's. The lookup goes through cloud_shares to the card's ownership helper, like cloud_share_visits.
create policy "cloud_share_grants: read as card owner" on public.cloud_share_grants
  for select to authenticated using (
    exists (select 1 from public.cloud_shares s where s.id = share_id and private.is_card_owner(s.org_id, s.card_id))
  );
create policy "cloud_share_grants: add as card owner" on public.cloud_share_grants
  for insert to authenticated with check (
    exists (select 1 from public.cloud_shares s where s.id = share_id and private.is_card_owner(s.org_id, s.card_id))
  );
create policy "cloud_share_grants: remove as card owner" on public.cloud_share_grants
  for delete to authenticated using (
    exists (select 1 from public.cloud_shares s where s.id = share_id and private.is_card_owner(s.org_id, s.card_id))
  );
-- granted_by, the timestamps and the stamps are left out of the insert grant: the database fills them, and only
-- the service role can say an email went out or someone opened it.
grant select on public.cloud_share_grants to authenticated;
grant insert (share_id, github_id, github_login, via) on public.cloud_share_grants to authenticated;
grant delete on public.cloud_share_grants to authenticated;

-- The gate's one question, in one round trip: is this signed-in account's GitHub identity granted on this share?
-- A yes stamps opened_at the first time. Reads auth.identities, so it's the service role's only.
create function public.share_grant_admits(share text, uid uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with hit as (
    update public.cloud_share_grants g
       set opened_at = coalesce(g.opened_at, now())
      from auth.identities i
     where g.share_id = share
       and i.user_id = uid
       and i.provider = 'github'
       and i.provider_id = g.github_id::text
    returning 1
  )
  select exists (select 1 from hit);
$$;

-- Who to tell: the email of the weft.zip account signed in with this GitHub id, when there is one.
create function public.share_grant_contact(github bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
    from auth.identities i
    join auth.users u on u.id = i.user_id
   where i.provider = 'github' and i.provider_id = github::text and u.email is not null
   limit 1;
$$;

revoke all on function public.share_grant_admits(text, uuid) from public, anon, authenticated;
revoke all on function public.share_grant_contact(bigint) from public, anon, authenticated;
grant execute on function public.share_grant_admits(text, uuid) to service_role;
grant execute on function public.share_grant_contact(bigint) to service_role;
