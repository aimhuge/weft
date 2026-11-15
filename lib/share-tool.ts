// mcp__board__share_card: a thread makes the public weft.zip link for its own card, the one the Share button makes
// (docs/architecture/sharing.md#share_card-a-thread-shares-its-own-card). Built for demo videos and pages a thread wants
// in a PR or an issue, without stopping to ask the user to click Share and paste the link back.
//
//   on a Mac      setCardShare (lib/card-share.ts), as the Share dialog's PUT does, through the signed-in account
//   on a worker   worker_share_card (supabase/migrations/*_worker_share_card.sql) with the worker's key, own card only
//
// The link leads with what the card's pane shows last (paneFor in @weft/client: the newest open_url), live, so `page`
// is a check, not a pin: the thread opens the page first, and the tool refuses when the pane shows something else.
// The first public share of a card asks the user (lib/share-consent.ts); the handler stamps the consent once it runs.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { slugCandidates } from "./app-share-slug";
import { threadSlugFrom } from "./card-share-slug";
import { cardShareLink, newShareId, type CardShareState, type CardShareUpdate } from "./share-types";
import { decorateCard, getCard, getThread } from "./store";
import type { Card, ThreadItem } from "./types";
import { boardLink, type BoardLink } from "./worker-board-link";
import { onWorker } from "./worker-pane";

type Mode = "public" | "private";
type Reply = { content: { type: "text"; text: string }[]; isError?: boolean };

const reply = (text: string, isError = false): Reply => ({ content: [{ type: "text", text }], ...(isError ? { isError } : {}) });

// A card not yet on weft.zip (the outbox or the publisher flushes within ~10 s) is tried this often, this far apart.
export const PUBLISH_TRIES = 6;
export const PUBLISH_WAIT_MS = 3000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// The page a share leads with: the newest open_url or page a message carried, as paneFor picks it (raw, before upload).
export function leadPage(items: readonly ThreadItem[]): string | null {
  let best: { at: number; page: string } | null = null;
  for (const item of items) {
    const raw = item.kind === "tool" && item.name === "mcp__browser__open_url" ? item.summary : item.kind === "user" ? item.page : undefined;
    if (raw && (!best || item.at >= best.at)) best = { at: item.at, page: raw };
  }
  return best?.page ?? null;
}

const bare = (page: string) => {
  const text = page.trim().replace(/^file:\/\//, "").replace(/\/+$/, "");
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
};

export function samePage(a: string, b: string): boolean {
  return bare(a) === bare(b);
}

// Why a Mac card can't be shared yet, as the thread should tell the user.
function blockedText(state: Exclude<CardShareState, { kind: "ok" } | { kind: "pending" }>): string {
  if (state.kind === "signed-out") return "Weft isn't signed in to a weft.zip account on this Mac, and a share link lives on one. Ask the user to sign in (top bar), then call share_card again.";
  if (state.kind === "no-workspace") return "The signed-in account has no workspace for cloud sync yet, and a share shows what sync uploads. Ask the user to turn on Sync (Settings → Sync), then call share_card again.";
  return `Sync is off for ${state.folder}, and a share shows what sync uploads. Ask the user to turn on Sync for this project (Settings → Sync), then call share_card again.`;
}

export interface MacShareDeps {
  set: (cardId: string, update: CardShareUpdate) => Promise<CardShareState>;
  nudge: () => void;
  wait: (ms: number) => Promise<void>;
}

// Loaded on first use: a worker never takes this path, and card-share brings the account and cloud sync with it.
const MAC_DEPS: MacShareDeps = {
  set: async (cardId, update) => (await import("./card-share")).setCardShare(cardId, update),
  nudge: () => void import("./cloud-sync").then((m) => m.syncNow()),
  wait: sleep,
};

// A Mac card's link: the Share dialog's write, waiting out the moments before the card's row is up.
export async function shareOnMac(cardId: string, mode: Mode, showChat: boolean, deps: MacShareDeps = MAC_DEPS): Promise<string> {
  for (let i = 0; i < PUBLISH_TRIES; i++) {
    const state = await deps.set(cardId, { mode, showChat });
    if (state.kind === "ok") {
      if (!state.url) throw new Error("weft.zip answered without a link; try again.");
      return state.url;
    }
    if (state.kind !== "pending") throw new Error(blockedText(state));
    deps.nudge();
    await deps.wait(PUBLISH_WAIT_MS);
  }
  throw new Error("This card hasn't reached weft.zip yet (cloud sync uploads it within a minute). Call share_card again shortly.");
}

const notPublished = (err: unknown) => err instanceof Error && /not published yet/i.test(err.message);

// A worker card's link, through the worker's key: its own card only, created_by its owner.
export async function shareOnWorker(
  card: Pick<Card, "id" | "title" | "share">,
  mode: Mode,
  showChat: boolean,
  link: Pick<BoardLink, "shareCard">,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<string> {
  if (!link.shareCard) throw new Error("This worker predates share_card. Update it with restart_weft_when_idle, then try again.");
  const args = { cardId: card.id, mode, showChat, shareId: card.share?.id ?? newShareId(), slugs: slugCandidates(threadSlugFrom(card.title)) };
  for (let i = 0; ; i++) {
    try {
      const row = await link.shareCard(args);
      const url = cardShareLink(row.id, row.slug, row.username);
      decorateCard(card.id, { share: { id: row.id, mode, hasPassword: false, url, slug: row.slug, showChat: row.show_chat } });
      return url;
    } catch (err) {
      if (!notPublished(err) || i >= PUBLISH_TRIES - 1) throw err;
      await wait(PUBLISH_WAIT_MS);
    }
  }
}

export interface ShareArgs {
  public?: boolean;
  show_chat?: boolean;
  page?: string;
}

export async function shareCard(cardId: string | undefined, args: ShareArgs): Promise<string> {
  const card = cardId ? getCard(cardId) : undefined;
  if (!card) throw new Error("This thread has no card yet.");
  const mode: Mode = args.public === false ? "private" : "public";
  const showChat = args.show_chat === true;
  const lead = leadPage(getThread(card.id));
  if (args.page && (!lead || !samePage(args.page, lead))) {
    throw new Error(`The link leads with the page the pane shows last${lead ? ` (${lead})` : " (nothing yet)"}. Open ${args.page} with mcp__browser__open_url first, then call share_card again.`);
  }
  // The consent gate (lib/share-consent.ts) let this call through, so the user allowed publishing this card.
  if (mode === "public" && !card.shareConsent) decorateCard(card.id, { shareConsent: true });
  const url = onWorker() ? await shareOnWorker(card, mode, showChat, boardLink()) : await shareOnMac(card.id, mode, showChat);
  if (mode === "private") return `The link is private now: only members of the user's workspace get in. ${url}`;
  const who = showChat ? "this thread beside its browser pane" : "the browser pane only (the chat stays hidden)";
  const leads = lead ? `It leads with ${lead}, and follows the pane live.` : "The pane has shown nothing yet, so it shows the card's pane capture until you open a page.";
  return `Public link: ${url}\nAnyone with it sees ${who}, no sign-in needed. ${leads}`;
}

// In every board thread's tools (lib/board-tools.ts), on a Mac and on a Weft Worker.
export function shareTool(getCardId: () => string | undefined) {
  return tool(
    "share_card",
    "Publish this thread's own card at a weft.zip link anyone can open, the same link the Share button makes, and get the URL back (for a PR, an issue or a message). The page shows what this card's browser pane shows, live: open_url the page or video to lead with first. The chat stays hidden unless show_chat is true. The first public share of a card asks the user; public: false takes the link back to private.",
    {
      public: z.boolean().optional().describe("true (default) publishes the link; false makes it private again (workspace members only)"),
      show_chat: z.boolean().optional().describe("Show this thread's chat beside the pane (default false: pane only)"),
      page: z.string().optional().describe("The page the link should lead with, as you passed it to open_url; checked against what the pane shows last"),
    },
    async (args) => {
      try {
        return reply(await shareCard(getCardId(), args));
      } catch (err) {
        return reply(err instanceof Error ? err.message : String(err), true);
      }
    },
  );
}
