// The card's current pane page, kept on the card itself so its synced row (lib/cloud-sync-cards.ts) can name it:
// a phone feed draws a card from that row alone, without its thread items (docs/architecture/cloud-sync.md#the-cards-page).
// Every page the pane opens for a card counts: the agent's open_url and Weft's own starter and update pages (lib/show.ts),
// which aren't thread items. A few field writes on the store, so the tools stay as fast as before.
import { decorateCard, getCard } from "./store";

export function notePage(cardId: string | undefined, url: string) {
  const page = url.trim();
  if (!cardId || !page || page === "about:blank") return;
  const card = getCard(cardId);
  if (!card) return;
  decorateCard(cardId, { page, pages: (card.pages ?? 0) + 1 });
}
