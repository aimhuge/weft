-- A card's share link gets the address a mini app's has (weft.zip/@<user>/threads/<slug>) and a choice to show the
-- chat or only the pane (docs/architecture/sharing.md). The slug is unique per sharer, the way a mini app's is per
-- owner; /s/<id> keeps working and redirects to it. show_chat = false means the viewer and its live poll never get
-- the thread's items, only the card's header and its pane.
alter table public.cloud_shares
  add column slug text check (slug is null or slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  add column show_chat boolean not null default true;

create unique index cloud_shares_slug_by_creator
  on public.cloud_shares (created_by, slug) where slug is not null;

-- Per-column grants, as in 20261017074157_card_shares.sql: the owner's Mac reads and writes both.
grant select (slug, show_chat) on public.cloud_shares to authenticated;
grant insert (slug, show_chat) on public.cloud_shares to authenticated;
grant update (slug, show_chat) on public.cloud_shares to authenticated;
