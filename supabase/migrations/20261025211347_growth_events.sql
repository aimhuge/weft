-- Growth events: the new-user, new-team and payment rows the Slack growth channel posts (docs/architecture/slack.md).
--
-- The three kinds, and what counts as each:
--
-- - **New user**: a sign-up. Every sign-up creates a personal org (the on_auth_user_created_workspace trigger), so
--   orgs.created_at counts sign-ups and NOT teams — a team is an org with members beyond its owner.
-- - **New team**: an org with more than one member, or one that a second person joined. A personal org is a
--   person's own workspace, not a team, so it doesn't count.
-- - **Payment**: a row in public.org_billing_events — a subscription created, a renewal paid, a plan changed.
--   actor_email is null for provider-initiated events (a renewal), which is fine: the org is what matters.
--
-- The function reads the rows since a time the caller gives it, and returns them as jsonb: one object per event,
-- with `kind` telling them apart. It is service-role only, like the other growth reads (20261018054110): the
-- accounts, the orgs and the billing trail are all private, and a signed-in key must not be able to count them.
--
-- The rows are read once and posted, so the caller keeps its own watermark; the function does not mark anything
-- as seen. That way a missed post can be re-read by asking for a wider window.

create or replace function public.growth_events(since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with signups as (
    select u.id, u.created_at, u.email
      from auth.users u
     where u.created_at >= since
  ),
  -- A team is an org with people in it beyond its first member: a personal org has exactly one.
  teams as (
    select o.id, o.name, o.slug, o.created_at, count(m.user_id)::int as members
      from public.orgs o
      join public.org_memberships m on m.org_id = o.id
     where o.created_at >= since
     group by o.id, o.name, o.slug, o.created_at
    having count(m.user_id) > 1
  ),
  payments as (
    select b.id, b.org_id, b.kind, b.actor_email, b.created_at, b.payload,
           o.name as org_name, o.slug as org_slug,
           s.plan, s.status, s.unit_amount_cents, s.currency, s.seats
      from public.org_billing_events b
      join public.orgs o on o.id = b.org_id
      left join public.org_subscriptions s on s.org_id = b.org_id
     where b.created_at >= since
       -- Only the money events. 'subscription.synced' is the mirror of the same subscription, written once per
       -- sync, so counting it would report one payment five times.
       and b.kind in ('invoice.paid', 'subscription.created', 'subscription.canceled', 'subscription.resumed')
  )
  select coalesce(jsonb_agg(event order by event->>'at'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'kind', 'user',
               'id', s.id::text,
               'email', s.email,
               'at', s.created_at
             ) as event
        from signups s
      union all
      select jsonb_build_object(
               'kind', 'team',
               'id', t.id::text,
               'name', t.name,
               'slug', t.slug,
               'members', t.members,
               'at', t.created_at
             )
        from teams t
      union all
      select jsonb_build_object(
               'kind', 'payment',
               'id', p.id::text,
               'event', p.kind,
               'org', p.org_name,
               'slug', p.org_slug,
               'actor', p.actor_email,
               'plan', p.plan,
               'status', p.status,
               'amount_cents', p.unit_amount_cents,
               'currency', p.currency,
               'seats', p.seats,
               'at', p.created_at
             )
        from payments p
    ) events;
$$;

revoke all on function public.growth_events(timestamptz) from public, anon, authenticated;
grant execute on function public.growth_events(timestamptz) to service_role;

comment on function public.growth_events(timestamptz) is
  'New users, new teams and payments since a time, as jsonb. Service role only.';
