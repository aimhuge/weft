-- The card's current pane page on its synced row, so a feed (the phone app, the web board) draws a card
-- without loading its thread items. Written by lib/cloud-sync-cards.ts from the card's own `page` / `pages`
-- (lib/card-page.ts); documented in docs/architecture/cloud-sync.md#the-cards-page.
--
-- page:       what the pane shows now: `blob:sha256:<hex>#anchor` for a page Weft uploaded (a ~/.weft/show
--             page, Weft's own starter or update page included), an https URL for a public site, or the
--             URL as it was for a page only the owner's Mac can reach (localhost, a dev server, a file).
-- page_thumb: for that last kind only, the card's pane capture (a blob ref) to draw instead.
-- pages:      how many pages the pane has opened on this card.
--
-- The table's existing grants and policies cover the new columns.
alter table public.cloud_cards
  add column if not exists page text,
  add column if not exists page_thumb text,
  add column if not exists pages integer not null default 0;
