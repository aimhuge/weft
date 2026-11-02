// What the session line's `events` channel carries (lib/host-line.ts): the engine's card and thread events, projected
// exactly as the relay mirrors them (lib/card-rows.ts: redacted, scrubbed, a long tool result cut out to fetch on
// demand), so a board reads the same card off the line as off the rows. The copilot stays off it, as it stays off the
// rows; streaming deltas, logins and the rest of the bus are this box's own.
import { projectCard, projectItem, publishes, type RowHost } from "./card-rows";
import type { LineEvent } from "./host-line-protocol";
import type { BoardEvent, Card } from "./types";

export function lineProjector(host: RowHost, getCard: (id: string) => Card | undefined) {
  const mirrored = (cardId: string) => {
    const card = getCard(cardId);
    return Boolean(card && publishes(card, host));
  };
  return async (event: BoardEvent): Promise<LineEvent | null> => {
    if (event.type === "card") return publishes(event.card, host) ? { t: "card", card: (await projectCard(event.card, host)).card } : null;
    if (event.type === "card_deleted") return { t: "card_deleted", id: event.id };
    if (event.type === "thread_cleared") return mirrored(event.cardId) ? { t: "thread_cleared", cardId: event.cardId } : null;
    if (event.type !== "thread" || !mirrored(event.cardId)) return null;
    const { item } = await projectItem(event.index, event.item, host);
    return { t: "thread", cardId: event.cardId, index: event.index, item: item.item, ...(event.truncate ? { truncate: true } : {}) };
  };
}
