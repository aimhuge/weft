-- Referrals (docs/architecture/billing.md "Coupons and referrals"). Every workspace may have one referral code: a Stripe
-- promotion code on the shared referral coupon, stamped with the workspace as referrer. When a checkout that used it
-- completes, the webhook (lib/billing/referral-webhook.ts) writes a referrals row for the workspace that bought, and
-- credits the referrer's Stripe balance (lib/billing/referrals.ts). Like every billing table: RLS on, no policies, so
-- only the service-role client on the deployed Weft (and the admin console) reads or writes them.

create table if not exists public.referral_codes (
  org_id           uuid primary key references public.orgs(id) on delete cascade,
  code             text not null unique,
  -- The Stripe promotion code per mode: { "live": "promo_…", "test": "promo_…" }.
  promotion_codes  jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create table if not exists public.referrals (
  id                   uuid primary key default gen_random_uuid(),
  referrer_org_id      uuid not null references public.orgs(id) on delete cascade,
  -- A workspace is referred once: its first paid checkout with a code.
  referred_org_id      uuid not null unique references public.orgs(id) on delete cascade,
  code                 text not null,
  mode                 text not null check (mode in ('live', 'test')),
  -- converted: the checkout completed, the reward isn't paid yet. rewarded: the referrer's balance was credited.
  -- void: a self-referral, or one an admin voided.
  status               text not null default 'converted' check (status in ('converted', 'rewarded', 'void')),
  checkout_session_id  text unique,
  reward_cents         integer not null default 0 check (reward_cents >= 0),
  rewarded_at          timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_org_id, created_at desc);

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
