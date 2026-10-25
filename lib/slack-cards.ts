import { subscribe } from "./bus";
import { cardLink } from "./slack-link";
import { cardRootMessage, cardUpdateMessage, previewOf } from "./slack-messages";
import { postToSlack } from "./slack-post";
import { channelFor } from "./slack-route";
import { cardThread, saveCardThread, slackSettings } from "./slack-store";
import type { SlackThread } from "./slack-types";
import { getCard, getThread, listCards } from "./store";
import { COPILOT_ID, type Card, type Column } from "./types";

// Card status in Slack (docs/architecture/slack.md): when a card lands in Needs you, Review or Done, its Slack thread
// gets a reply with the column, stage, what's left, a preview of its latest reply and the link to it on weft.zip.
// A card started from Slack always has a thread (lib/slack-inbound.ts); any other card gets one, under a first
// message in the channel, when "Card status" is on. Running and Backlog aren't posted: every turn passes through
// Running, and a thread that pinged on each would be muted by lunch.

const POSTED: readonly Column[] = ["needs_you", "review", "done"];

// A card often moves twice in a second (Review, then Done on a Commit click): it posts once it has held still this long.
export const SETTLE_MS = 2_000;

function latestReply(cardId: string): string {
  const items = getThread(cardId);
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === "assistant" && item.text.trim()) return item.text;
  }
  return "";
}

// The card's thread, made under a first message in the channel when it has none yet.
async function threadFor(card: Card, link: string | null): Promise<SlackThread | null> {
  const known = cardThread(card.id);
  if (known) return known;
  const settings = slackSettings();
  const channel = channelFor(settings, card.cwd);
  if (!channel || !settings.events.status) return null;
  const root = await postToSlack(channel, cardRootMessage(card.title, card.cwd, link));
  if (root.ts) saveCardThread(card.id, root);
  return root.ts ? root : null;
}

export async function postCardStatus(cardId: string): Promise<boolean> {
  const card = getCard(cardId);
  if (!card || !POSTED.includes(card.column)) return false;
  const link = await cardLink(card.id, card.cwd);
  const thread = await threadFor(card, link);
  if (!thread) return false;
  const preview = previewOf(latestReply(card.id));
  await postToSlack(thread.channel, cardUpdateMessage({ ...card, preview, link }), thread.ts);
  return true;
}

// Listens to the board for column changes. Returns the unsubscribe.
export function watchCardStatus(): () => void {
  const column = new Map(listCards().map((c) => [c.id, c.column]));
  const posted = new Map<string, Column>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function settle(id: string) {
    timers.delete(id);
    const now = getCard(id)?.column;
    if (!now || posted.get(id) === now) return;
    posted.set(id, now);
    postCardStatus(id).catch((err: unknown) => {
      // Not posted after all: the card's next landing in this column tries again.
      posted.delete(id);
      console.warn(`[weft] slack: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  const stop = subscribe((event) => {
    if (event.type !== "card" || event.card.id === COPILOT_ID) return;
    const { id, column: now } = event.card;
    const before = column.get(id);
    column.set(id, now);
    if (before === undefined || before === now) return;
    // Back to work: the next landing posts even if it's the same column as last time.
    if (!POSTED.includes(now)) {
      posted.delete(id);
      return;
    }
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => settle(id), SETTLE_MS));
  });

  return () => {
    stop();
    for (const t of timers.values()) clearTimeout(t);
  };
}
