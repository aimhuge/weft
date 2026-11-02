// The board tools on a Weft Worker (docs/architecture/project-hosts.md#board-tools-on-a-worker). lib/board-tools.ts
// builds the same tools everywhere; on a worker, onWorkerBoard swaps the ones that would write the worker's private
// store for ones that reach the user's board (lib/worker-board-link.ts), keeping each tool's name and schema:
//
//   list_cards    this worker's cards and every other synced card of the owner's
//   create_card   a project on this worker starts here; another host's gets a new_card (Mac) or run (worker) command
//   create_cron   only for this worker's projects: a cron fires where its cards run, and the worker publishes its
//                 crons for the Mac's ⏰ drawer (lib/worker-lists.ts)
//   list_crons    this worker's crons, saying so
//   create_agent  refused: agents live in the user's Settings → Agents, on their Mac
// The changelog tools stay as they are: the entry lands in the checkout's own CHANGELOG.md after the card's commit
// (lib/changelog-stamp.ts runs in every runner), which is what the user sees once the worker pushes.
import { firstMessage } from "./automations";
import { listText, type ListOptions } from "./board-tools-format";
import { getCard, listCards } from "./store";
import type { Card, PermissionMode } from "./types";
import { boardCards, boardLink, BOARD_READ, localFolder, remoteTarget } from "./worker-board-link";

type Reply = { content: { type: "text"; text: string }[]; isError?: boolean };
// A tool definition as lib/board-tools.ts makes them (the SDK's tool()); only the name and handler are read or replaced.
type Handler = (args: never, extra: unknown) => Promise<unknown>;
interface NamedTool {
  name: string;
  handler: Handler;
}

const reply = (text: string, isError = false): Reply => ({ content: [{ type: "text", text }], ...(isError ? { isError } : {}) });

async function attempt(run: () => string | Promise<string>): Promise<Reply> {
  try {
    return reply(await run());
  } catch (err) {
    return reply(err instanceof Error ? err.message : String(err), true);
  }
}

export const AGENT_REFUSED =
  "Agents live in Settings → Agents on the user's Mac, and this thread runs on a Weft Worker, so create_agent can't save one here. Write the agent's name, emoji, one line and soul in your reply, and ask the user to add it there (or to start a card in a Mac project that calls create_agent).";

export interface NewCardArgs {
  prompt: string;
  title?: string;
  folder?: string;
  start?: boolean;
  tags?: string[];
  agent?: string;
}

export interface WorkerBoardDeps {
  getCardId: () => string | undefined;
  start(cardId: string, text: string): void;
  // lib/board-tools.ts createBoardCard, for a card in this worker's own project.
  create(args: { prompt: string; title?: string; folder: string; permissionMode: PermissionMode; parentId?: string; tags?: string[]; agent?: string }): Card;
  defaultMode: () => PermissionMode;
}

const parentOf = (deps: WorkerBoardDeps) => {
  const id = deps.getCardId();
  return id ? getCard(id) : undefined;
};

export async function workerListCards(opts: ListOptions): Promise<string> {
  return listText(await boardCards(listCards()), opts);
}

// What a new_card or run carries: never a mode or an agent; the host that runs it picks its own.
function remotePayload(args: NewCardArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = { prompt: args.prompt };
  if (args.title) payload.title = args.title;
  if (args.tags?.length) payload.tags = args.tags;
  if (args.start === false) payload.start = false;
  return payload;
}

// A card a worker sends never runs unasked there (lib/worker-origin.ts): a Mac files it in Backlog for the user to start,
// and a worker starts it in `default`, asking before each edit and command.
function arrival(where: string, start: boolean | undefined): string {
  if (where === "Mac") return "It lands in Backlog there, tagged from-worker, for the user to start: a worker's card never starts itself on their Mac.";
  return `It ${start === false ? "lands in Backlog" : "starts"} there once that worker takes it, in default mode (it asks before edits and commands).`;
}

export async function workerCreateCard(args: NewCardArgs, deps: WorkerBoardDeps): Promise<string> {
  const link = boardLink();
  const parent = parentOf(deps);
  const here = localFolder(args.folder ?? "", link, parent?.cwd ?? "");
  if (here) {
    const card = deps.create({ ...args, folder: here, permissionMode: parent?.permissionMode ?? deps.defaultMode(), parentId: parent?.id });
    if (args.start === false) return `Created ${card.id} in Backlog: ${card.title}`;
    deps.start(card.id, firstMessage(card));
    return `Created and started ${card.id}: ${card.title}`;
  }
  const to = remoteTarget(args.folder ?? "", await link.cards(BOARD_READ), link.workerId);
  const id = await link.newCard(to.target, to.folder, remotePayload(args));
  const agent = args.agent ? " The agent isn't carried to another host yet: that project's default agent runs it." : "";
  return `Sent to your ${to.where} for ${to.folder} (command ${id}). ${arrival(to.where, args.start)} list_cards shows the card after.${agent}`;
}

export const CRON_ELSEWHERE =
  "A cron fires where its runs work, and this thread is on a Weft Worker, so it can only schedule this worker's own projects. For a project on the user's Mac or another worker, make the cron from a thread there.";

const withHandler = <T extends NamedTool>(t: T, handler: (args: never, extra: unknown) => Promise<Reply>): T => ({ ...t, handler });

function wrapCron<T extends NamedTool>(t: T, deps: WorkerBoardDeps): T {
  const handler = t.handler as unknown as (args: Record<string, unknown>, extra: unknown) => Promise<Reply>;
  if (t.name === "create_cron") {
    return withHandler(t, async (args: Record<string, unknown>, extra: unknown) => {
        const cardId = typeof args.card_id === "string" ? args.card_id : undefined;
        if (cardId && !getCard(cardId)) return reply(`${CRON_ELSEWHERE} (${cardId} isn't a card on this worker.)`, true);
        if (typeof args.folder !== "string" || !args.folder) return handler(args, extra);
        const here = localFolder(args.folder, boardLink(), parentOf(deps)?.cwd ?? "");
        return here ? handler({ ...args, folder: here }, extra) : reply(CRON_ELSEWHERE, true);
    });
  }
  if (t.name === "list_crons") {
    return withHandler(t, async (args: Record<string, unknown>, extra: unknown) => {
        const out = await handler(args, extra);
        const note = "These are this Weft Worker's crons: they fire here, and the user's ⏰ drawer lists them beside their Mac's. Crons on the Mac aren't listed from a worker.";
        return { ...out, content: [...out.content, { type: "text" as const, text: note }] };
    });
  }
  return t;
}

// The board tools a worker thread gets: the same names and schemas, with what writes the user's board routed there.
export function onWorkerBoard<T extends NamedTool>(tools: T[], deps: WorkerBoardDeps): T[] {
  return tools.map((t) => {
    if (t.name === "list_cards") return withHandler(t, (args: ListOptions) => attempt(() => workerListCards(args)));
    if (t.name === "create_card") return withHandler(t, (args: NewCardArgs) => attempt(() => workerCreateCard(args, deps)));
    if (t.name === "create_agent") return withHandler(t, () => Promise.resolve(reply(AGENT_REFUSED, true)));
    return wrapCron(t, deps);
  });
}
