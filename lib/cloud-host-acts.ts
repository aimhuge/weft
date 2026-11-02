// weft.zip's way to a card's host verbs (docs/architecture/project-hosts.md, H3b): the same `host` command the
// desktop sends a worker (lib/host-row.ts), inserted with the visitor's own session for whichever machine runs the
// card, the Mac's inbox (lib/cloud-inbox-cards.ts) or a worker's daemon. The web board's transport
// (components/web-board/useCloudTransport.ts) hands these on as its ↑ edit, Send fresh, Send later and "/" list.
//
// Each is followed to its result, as actOnWorker does on the desktop (lib/worker-acts.ts): a refusal rejects, so the
// reply box puts the text back; one the machine hasn't taken within a few seconds answers `{ queued }`, a promise that
// settles when it runs or is refused, so Send later keeps its row drawn until then. A queued ↑ edit or Send fresh
// resolves at once (the box can't wait an hour); if it's refused later, its failed row shows above the box with its
// text (lib/web-commands.ts cardReplies), so nothing typed is lost silently.
import type { NewCommand } from "./cloud-commands";
import type { HostVerb } from "./host-api/types";
import { hostRow, type CardTarget } from "./host-row";
import { skillCache } from "./skills-wire";
import type { SkillInfo } from "./types";
import type { Queued } from "./optimistic-cards";
import { waitForCommand, type CommandResult, type WaitOptions } from "./worker-command-wait";
import { ACT_WAIT, QUEUED_WAIT } from "./worker-acts";

export type { CardTarget };

export interface CloudHostInput {
  // Where the card runs, or why a command can't be addressed to it.
  target: (cardId: string) => CardTarget | string;
  // Puts a row in; resolves to its id, or why it couldn't be sent.
  insert: (row: NewCommand) => Promise<{ id: string } | string>;
  // How a command went, its `result` included.
  read: (commandId: string) => Promise<CommandResult>;
  wait?: WaitOptions;
  queuedWait?: WaitOptions;
}

export interface CloudHostActs {
  editLast: (cardId: string, text: string) => Promise<void>;
  fresh: (cardId: string, message: string) => Promise<void>;
  schedule: (cardId: string, text: string, at: number) => Promise<Queued | undefined>;
  unschedule: (cardId: string, messageId: string) => Promise<Queued | undefined>;
  listSkills: (cardId: string | undefined) => Promise<SkillInfo[]>;
}

function outcome(result: CommandResult, fallback: string): CommandResult {
  if (result.status === "failed") throw new Error(result.error || fallback);
  return result;
}

export function cloudHostActs({ target, insert, read, wait = ACT_WAIT, queuedWait = QUEUED_WAIT }: CloudHostInput): CloudHostActs {
  async function send(verb: HostVerb, cardId: string, args: Record<string, unknown>): Promise<string> {
    const to = target(cardId);
    if (typeof to === "string") throw new Error(to);
    const sent = await insert(hostRow(to, verb, args));
    if (typeof sent === "string") throw new Error(sent);
    return sent.id;
  }

  // Sent and followed: undefined once it ran, a rejection if it was refused, `{ queued }` while it waits.
  async function act(verb: HostVerb, cardId: string, args: Record<string, unknown>): Promise<Queued | undefined> {
    const id = await send(verb, cardId, args);
    const first = outcome(await waitForCommand(() => read(id), wait), "Your Mac couldn't do that.");
    if (first.status === "done") return undefined;
    const queued = waitForCommand(() => read(id), queuedWait).then((r) => void outcome(r, "Your Mac couldn't do that."));
    // Whoever holds it handles a refusal; nobody holding it isn't an unhandled rejection.
    queued.catch(() => {});
    return { queued };
  }

  const skills = skillCache(async (cardId) => {
    const id = await send("skills.list", cardId, {});
    const result = outcome(await waitForCommand(() => read(id), wait), "Couldn't read the skills.");
    if (result.status !== "done") throw new Error("The machine that runs this card didn't answer. It may be off.");
    return result.result;
  });

  return {
    editLast: (cardId, text) => act("card.message.edit", cardId, { text }).then(() => {}),
    fresh: (cardId, message) => act("card.fresh", cardId, { message }).then(() => {}),
    schedule: (cardId, text, at) => act("card.schedule", cardId, { text, at }),
    unschedule: (cardId, messageId) => act("card.unschedule", cardId, { messageId }),
    listSkills: (cardId) => skills.get(cardId),
  };
}
