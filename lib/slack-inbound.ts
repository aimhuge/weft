import { createCardFromBody, startCard } from "./new-card";
import { sendMessage } from "./runner";
import { cardLink } from "./slack-link";
import { cardRootMessage, noticeMessage } from "./slack-messages";
import { postToSlack } from "./slack-post";
import { folderFor } from "./slack-route";
import { cardOfThread, saveCardThread, slackSettings } from "./slack-store";
import type { SlackInbound } from "./slack-types";
import { getCard } from "./store";

// Slack talking to Weft (docs/architecture/slack.md). Main hears it over Socket Mode, acks Slack at once and forwards
// it here (POST /api/slack/inbound). `/weft <prompt>` or an @mention starts a card in the drawer's project; an
// @mention inside a card's Slack thread is a message to that card instead, the way a reply on the board would be.

export type InboundResult = { kind: "started"; cardId: string } | { kind: "sent"; cardId: string } | { kind: "refused"; reason: string };

const HOW = "Tell Weft what to build: `/weft fix the login bug`, or @Weft with it.";

async function refuse(inbound: SlackInbound, reason: string): Promise<InboundResult> {
  await postToSlack(inbound.channel, noticeMessage(reason), inbound.threadTs ?? inbound.ts);
  return { kind: "refused", reason };
}

// A mention in a card's thread: the text goes to the card as your next message.
async function toCard(inbound: SlackInbound, cardId: string): Promise<InboundResult> {
  if (!getCard(cardId)) return refuse(inbound, "That card isn't on the board any more.");
  if (!inbound.text) return refuse(inbound, "Say what the card should do next after @Weft.");
  sendMessage(cardId, inbound.text);
  await postToSlack(inbound.channel, noticeMessage("↪️ Sent to the card. Its next status lands here."), inbound.threadTs);
  return { kind: "sent", cardId };
}

export async function handleInbound(inbound: SlackInbound): Promise<InboundResult> {
  const text = inbound.text.trim();
  const thread = inbound.threadTs ? cardOfThread(inbound.channel, inbound.threadTs) : null;
  if (thread) return toCard({ ...inbound, text }, thread);
  if (!text) return refuse(inbound, HOW);
  // The project mapped to this channel, else the default one.
  const folder = folderFor(slackSettings(), inbound.channel);
  if (!folder) return refuse(inbound, "Map this channel to a project, or pick a default one: Weft → Slack on the left rail.");

  const card = createCardFromBody({ prompt: text, cwd: folder, tags: ["slack"] });
  const link = await cardLink(card.id, card.cwd);
  const root = cardRootMessage(card.title, card.cwd, link, inbound.user);
  // A mention's card replies under the mention; a slash command leaves no message, so the card's first one is the root.
  const under = inbound.kind === "mention" ? (inbound.threadTs ?? inbound.ts) : undefined;
  const posted = await postToSlack(inbound.channel, root, under);
  const ts = under ?? posted.ts;
  if (ts) saveCardThread(card.id, { channel: posted.channel, ts });
  // Started only once its thread is saved: a turn that fails at once lands in Needs you, and that update has to find
  // this thread rather than open a stray one in the drawer's channel.
  startCard(card);
  return { kind: "started", cardId: card.id };
}
