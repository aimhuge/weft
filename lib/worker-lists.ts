// A Weft Worker's crons and webhooks, published for the user's Mac (docs/architecture/project-hosts.md#board-tools-on-a-worker).
// Both live on the worker, because that's where they act: a cron's runs are cards in the worker's checkout, a webhook's
// target is the worker's own dev server. The worker sends the whole of both lists (cloud_worker_lists, owner-only)
// a moment after either changes, with each folder as its project name; the Mac's ⏰ and 🪝 drawers list them
// (lib/worker-lists-read.ts).
import path from "node:path";
import type { Cron } from "./cron-types";
import type { Webhook } from "./webhook-types";
import type { BoardLink } from "./worker-board-link";

// Enough for any drawer; the function refuses past 256 KB.
export const LIST_CAP = 200;
export const PUBLISH_DELAY_MS = 2_000;

// The fork's session points stay on the worker: the Mac can't resume them.
export const cronRow = (c: Cron): Cron => ({ ...c, cwd: path.basename(c.cwd), sessionId: undefined, resumeAt: undefined });
export const hookRow = (h: Webhook): Webhook => ({ ...h, folder: path.basename(h.folder), deliveries: h.deliveries?.slice(0, 3) });

export interface ListSources {
  crons(): Cron[];
  webhooks(): Webhook[];
}

// poke() after any change: the lists go once, PUBLISH_DELAY_MS later, however many changes came in between.
export function createListsPublisher(link: Pick<BoardLink, "setLists">, read: ListSources, log: (msg: string) => void = console.warn, delayMs = PUBLISH_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  async function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      await link.setLists(read.crons().slice(0, LIST_CAP).map(cronRow), read.webhooks().slice(0, LIST_CAP).map(hookRow));
    } catch (err) {
      log(`Weft Worker: couldn't publish its crons and webhooks: ${(err as Error).message}`);
    }
  }
  return {
    poke() {
      timer ??= setTimeout(() => void flush(), delayMs);
    },
    flush,
  };
}
