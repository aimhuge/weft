-- Asking a teammate for their card (lib/handover.ts, docs/architecture/cloud-sync.md#asking-for-a-handover): a member asks
-- the card's owner to hand it over; the owner's Mac shows the ask on the card, and on yes commits that card's changes
-- onto a branch and pushes it (lib/handover-push.ts); the asker's Mac then takes the card over from that branch
-- (lib/team-takeover.ts). The first thing one account's Mac does because another asked: only ever after its owner says
-- yes on it, and only ever this: push a branch and say which.

create table public.cloud_handovers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  card_id     text not null,
  -- Who asks: always the caller (the default), never a column a client writes.
  by_user     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Whose card it is, copied from cloud_cards by the trigger below.
  owner_user  uuid not null,
  -- asked → (owner) pushing → pushed | failed, or declined; (asker) cancelled, or taken once their card started.
  status      text not null default 'asked' check (status in ('asked', 'pushing', 'pushed', 'failed', 'declined', 'cancelled', 'taken')),
  -- Where the owner's Mac pushed the card's work, and the commit.
  branch      text,
  sha         text,
  -- Why a push failed, in the owner Mac's words.
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (org_id, card_id) references public.cloud_cards (org_id, card_id) on delete cascade
);

create index cloud_handovers_owner on public.cloud_handovers (owner_user, org_id, status);
create index cloud_handovers_asker on public.cloud_handovers (by_user, org_id, status);

-- owner_user is the card's owner as cloud_cards has it, whatever the insert says (the same function the takeovers use).
create trigger cloud_handovers_owner
  before insert on public.cloud_handovers
  for each row execute function private.takeover_owner();

create trigger cloud_handovers_touch_updated_at
  before update on public.cloud_handovers
  for each row execute function private.touch_updated_at();

-- An ask and each answer touch the card's row (the takeovers' function), so the asker's changed-cards read
-- (since=, lib/team-board.ts) redraws the card's bar without waiting for a whole read.
create trigger cloud_handovers_touch_card
  after insert or update on public.cloud_handovers
  for each row execute function private.takeover_touch_card();

alter table public.cloud_handovers enable row level security;
revoke all on public.cloud_handovers from anon, authenticated;

-- The asker and the owner read their own asks; nobody else in the workspace needs them.
create policy "cloud_handovers: read own" on public.cloud_handovers
  for select to authenticated using ((select auth.uid()) in (by_user, owner_user) and private.is_org_member(org_id));
grant select on public.cloud_handovers to authenticated;

-- A member asks for a card that isn't theirs, as themselves.
create policy "cloud_handovers: ask as member" on public.cloud_handovers
  for insert to authenticated
  with check ((select auth.uid()) = by_user and private.is_org_member(org_id) and not private.is_card_owner(org_id, card_id));
grant insert (org_id, card_id) on public.cloud_handovers to authenticated;

-- The owner answers: pushing, pushed (with the branch), failed (with a note) or declined.
create policy "cloud_handovers: owner answers" on public.cloud_handovers
  for update to authenticated
  using ((select auth.uid()) = owner_user)
  with check ((select auth.uid()) = owner_user and status in ('pushing', 'pushed', 'failed', 'declined'));

-- The asker calls it off, or marks it taken once their card started from the branch.
create policy "cloud_handovers: asker closes" on public.cloud_handovers
  for update to authenticated
  using ((select auth.uid()) = by_user)
  with check ((select auth.uid()) = by_user and status in ('cancelled', 'taken'));

grant update (status, branch, sha, note) on public.cloud_handovers to authenticated;
