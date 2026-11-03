// What a Weft Worker answers when a board reads it over its session line or a `host` row (H1): card.list and a card's
// thread.* (lib/host-api). Never more than its cloud rows already carry: card.list is the publisher's own projection of
// the cards it publishes (never the copilot), and a thread page's items, a tool result and a find are projected as its
// rows are (lib/card-rows.ts: the <weft-env> block stripped, free text redacted, scrubbed). Paths stay paths: a read
// uploads nothing. A find runs over that projection too, so its hit counts can't tell a guess at a key from a miss;
// it reads the thread as a page does, so a long tool result a page leaves out isn't searched here. lib/host/dispatch.ts runs these past the card check and remoteRefusal, as it does the files verbs.
import { projectItem, type RowHost } from "./card-rows";
import type { ThreadVerb } from "./host/dispatch";
import { redactText } from "./share-redact";
import { matchThread } from "./thread-find";
import type { ThreadPage } from "./thread-page";
import type { Engine } from "./worker-daemon";
import type { Publisher } from "./worker-publish";

const PLAIN: RowHost = { orgId: "", thumbs: false, copilot: false };

// A page's items as the worker's rows would carry them.
async function projected(page: ThreadPage): Promise<ThreadPage> {
  const items = await Promise.all(page.items.map(async (item, i) => (await projectItem(page.start + i, item, PLAIN)).item.item));
  return { ...page, items };
}

type Host = Pick<Engine, "host">["host"];

// One thread read, answered from the worker's store and projected as its rows are.
export async function threadRead(host: Host, verb: ThreadVerb, args: Record<string, unknown>): Promise<unknown> {
  if (verb === "thread.tool") return { result: redactText(((await host(verb, args)) as { result: string }).result) };
  if (verb === "thread.page") return projected((await host(verb, args)) as ThreadPage);
  const whole = await projected((await host("thread.page", { id: args.id })) as ThreadPage);
  return { matches: matchThread(whole.items, typeof args.q === "string" ? args.q : "") };
}

export interface WorkerReads {
  cards(): Promise<unknown>;
  threads(verb: ThreadVerb, args: Record<string, unknown>): Promise<unknown>;
}

export function workerReads(engine: Pick<Engine, "host">, publisher: Pick<Publisher, "snapshot">): WorkerReads {
  return {
    cards: async () => ({ cards: await publisher.snapshot() }),
    threads: (verb, args) => threadRead((v, a) => engine.host(v, a), verb, args),
  };
}
