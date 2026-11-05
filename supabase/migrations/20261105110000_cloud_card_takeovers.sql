-- Taking over a teammate's card (lib/team-takeover.ts, docs/architecture/cloud-sync.md#taking-over-a-teammates-card):
-- a member continues a teammate's synced card as a new card on their own Mac, and leaves one row here saying so.
-- The card itself stays its owner's (cloud_cards' write policies don't change): this row is only the mark their
-- board, and everyone else's, draws on it ("Taken over by Alex"), and the owner's Mac notes on its own copy.

create table public.cloud_card_takeovers (
  org_id      uuid not null,
  card_id     text not null,
  -- Who took it over: always the caller (the default), never a column a client writes.
  by_user     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Whose card it was, copied from cloud_cards by the trigger below, so the owner's Mac finds its taken cards
  -- with one indexed read instead of a join through every card it owns.
  owner_user  uuid not null,
  -- The taker's new card, on their Mac: its id is how their own board's copy is named.
  new_card_id text not null,
  at          timestamptz not null default now(),
  primary key (org_id, card_id, by_user),
  foreign key (org_id, card_id) references public.cloud_cards (org_id, card_id) on delete cascade
);

create index cloud_card_takeovers_owner on public.cloud_card_takeovers (owner_user, org_id);

-- owner_user is the card's owner as cloud_cards has it, whatever the insert says.
create or replace function private.takeover_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.owner_user into new.owner_user from public.cloud_cards c where c.org_id = new.org_id and c.card_id = new.card_id;
  if new.owner_user is null then
    raise exception 'No such card';
  end if;
  return new;
end;
$$;

create trigger cloud_card_takeovers_owner
  before insert on public.cloud_card_takeovers
  for each row execute function private.takeover_owner();

-- A takeover touches the card's row, so every board's changed-cards read (since=, lib/team-board.ts) and Realtime
-- hear of it without a read of their own. Runs as its owner: the taker can't update a card that isn't theirs.
create or replace function private.takeover_touch_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cloud_cards set updated_at = now() where org_id = new.org_id and card_id = new.card_id;
  return new;
end;
$$;

create trigger cloud_card_takeovers_touch
  after insert on public.cloud_card_takeovers
  for each row execute function private.takeover_touch_card();

revoke all on function private.takeover_owner() from public, anon, authenticated;
revoke all on function private.takeover_touch_card() from public, anon, authenticated;

alter table public.cloud_card_takeovers enable row level security;
revoke all on public.cloud_card_takeovers from anon, authenticated;

-- Members read every takeover in their workspace, as they read its cards.
create policy "cloud_card_takeovers: read as member" on public.cloud_card_takeovers
  for select to authenticated using (private.is_org_member(org_id));
grant select on public.cloud_card_takeovers to authenticated;

-- A member takes over a card that isn't theirs, as themselves. No updates; the taker may take their mark back.
create policy "cloud_card_takeovers: take as member" on public.cloud_card_takeovers
  for insert to authenticated
  with check ((select auth.uid()) = by_user and private.is_org_member(org_id) and not private.is_card_owner(org_id, card_id));
grant insert (org_id, card_id, new_card_id) on public.cloud_card_takeovers to authenticated;

create policy "cloud_card_takeovers: delete own" on public.cloud_card_takeovers
  for delete to authenticated using ((select auth.uid()) = by_user);
grant delete on public.cloud_card_takeovers to authenticated;
