// The kind table both hosts run a claimed command through (docs/architecture/project-hosts.md#the-host-command-h2-as-built).
// `host` runs any verb of lib/host-api, and the old card kinds are its aliases: `reply` → card.message, `answer` →
// card.permission.answer, `stop` → card.stop. The wire and every error message are unchanged. What only one host adds
// is data in its CardRules, not a second copy of the handler: a Mac's synced-folder card check, its phone-signature
// rule and the elevated verbs it keeps while a phone is paired, a worker's pasted-file transfer.
import { answerBody, answerGrant, replyBody, stopBody, type AnswerPayload, type CloudCommandRow, type GrantScope } from "../cloud-commands";
import type { HostVerb } from "../host-api";
import { isHostLevelVerb, isListVerb, type ListVerb } from "@weft/client";
import { hostResult, readHostCommand, remoteRefusal, textArgOf, verbResult, type HostArgs, type HostDone, type HostPayload } from "../host-command";
import { carriesValue, valueResult, type Carry } from "../host-result";
import type { Card } from "../types";
import { widenArgsOf, widenChangeOf, withoutWiden, type WidenChange } from "../widen";
import type { WidenTarget } from "../widen-check";
import type { Done } from "./identity";

// What a signed widening leaves unsigned: a card.update's body without the fields its approval covered, or null when the
// approval covers the verb whole (a "!" line, one sent later).
function unsignedRest({ verb, args }: HostPayload, change: WidenChange): Record<string, unknown> | null {
  if (verb !== "card.update") return null;
  const body = Object.fromEntries(Object.entries(args.body as Record<string, unknown>).filter(([key]) => !(key in change)));
  return { ...withoutWiden(args), body };
}

export type KindHandler = (command: CloudCommandRow) => Done | Promise<Done>;
export type KindTable = Record<string, KindHandler>;

// What a card kind does: the copilot line a Mac shows names it ("can't be answered from the web").
export type CardUse = "answered" | "stopped" | "reached";

export interface CardRules {
  // The card a command acts on, or the host's own "not here" error.
  card(cardId: string | undefined, command: CloudCommandRow, use: CardUse): Card;
  // One verb of lib/host-api, in this process (runVerb); resolves with the verb's reply.
  verb(verb: HostVerb, args: Record<string, unknown>): Promise<unknown>;
  // This card / Always on this host (lib/folder-grant.ts).
  grant(cardId: string, directory: string, scope: GrantScope): void;
  // The files a typed text pastes, brought onto this host first (a worker; lib/attachment-transfer.ts).
  receive?(text: string, payload: unknown): Promise<string>;
  // Why an answer can't go through: a Mac's approval rule, a signed answer only from a paired phone.
  approve?(command: CloudCommandRow, answer: AnswerPayload, card: Card): Promise<string | null>;
  // Why a verb that grants power can't run from the web here, if it can't (a Mac with a phone paired).
  elevated?(verb: HostVerb, args: Record<string, unknown>): Promise<string | null>;
  // Why a signed widening can't run here (lib/widen-check.ts), or null when its approval checks out. `refusal` is what
  // remoteRefusal said, for a command with no approval. Absent, every widening stays refused.
  widen?(target: WidenTarget, auth: unknown, refusal: string): Promise<string | null>;
  // A verb on the host itself (settings.get / settings.put), from the network. Absent: this host refuses them (a Mac).
  hostVerb?(verb: HostVerb, args: Record<string, unknown>): Promise<unknown>;
  // Whether the command's author is this host's owner. A verb in OWNER_VERBS runs only when it is; a host without the
  // rule can't say, so none of those verbs runs there from the network.
  fromOwner?(command: CloudCommandRow): boolean;
  // After a verb that changed a card ran: a Mac sends the change now rather than on the next tick.
  after?(): void;
  // A host card.permission.answer goes through the answer kind, so it takes the same approval rule (a Mac).
  answerAsKind?: boolean;
  // An answer carries a question reply's annotations and chat (a Mac).
  questionReplies?: boolean;
  // The error for a stop that names no card; without it the card check says it.
  emptyStop?: string;
  // Puts a verb's result that's over the row's cap (the editor's files.*) in the blob store, answering its sha; a host
  // without it answers only small ones (lib/host-result.ts).
  carry?: Carry;
  // card.create: makes the card the args name in the row's folder, and resolves with its id once it's published (a
  // worker). Without it the host makes cards through its own new_card kind (a Mac).
  create?(command: CloudCommandRow, args: Record<string, unknown>): Promise<string>;
  // cron.* and webhook.*: runs one on a cron or webhook this host keeps, past remoteRefusal, and resolves with the card a
  // run made (or null). Without it the host refuses them from the network (a Mac: its own are changed in its window).
  lists?(verb: ListVerb, args: HostArgs): Promise<string | null>;
}

// Verbs that put something on the internet or prompt the owner's Mac (dev.open: a tunnel and a Touch ID). Only the
// owner's own command runs them from the network, never another member's of the workspace.
export const OWNER_VERBS: ReadonlySet<HostVerb> = new Set<HostVerb>(["dev.open"]);
const NOT_OWNER = "Only the owner of this card can do that.";

const NO_CREATE = "This host starts new threads through new_card, not card.create.";
export const NO_LISTS = "This Mac's crons and webhooks change only in its own window (its ⏰ and 🪝 drawers, or a thread there), not from the network.";

// A host verb's answer as an answer kind: the same payload, so the same approval rule and a phone's signature
// (args.auth) over the same fields. It needs the request's pendingId, as the answer kind does.
export function asAnswer(command: CloudCommandRow, { args }: HostPayload): CloudCommandRow {
  const { id, pendingId, allow, answers, annotations, chat, auth } = args;
  const payload = { cardId: id, pendingId, allow, answers, reply: { annotations, chat }, auth } as AnswerPayload;
  return { ...command, kind: "answer", payload };
}

// Verbs a board runs for their answer, or to warm a CLI: they change no card, so there's nothing to sync after them.
const READS = new Set<HostVerb>(["skills.list", "files.list", "files.read", "files.write", "card.warm", "settings.get", "settings.put"]);

const NO_HOST_VERBS = "This host takes its settings only from its own window.";

export function cardKinds(rules: CardRules) {
  async function received(command: CloudCommandRow, args: Record<string, unknown>, field: string | undefined) {
    const typed = field ? args[field] : undefined;
    return rules.receive && typeof typed === "string" ? { ...args, [field as string]: await rules.receive(typed, command.payload) } : args;
  }

  async function verb(name: HostVerb, args: Record<string, unknown>): Promise<unknown> {
    const reply = await rules.verb(name, args);
    if (!READS.has(name)) rules.after?.();
    return reply;
  }

  // A reply goes to the card the way the reply box sends one: now, or after the turn that's running.
  async function reply(command: CloudCommandRow): Promise<string> {
    const body = replyBody(command);
    if (!body) throw new Error("That reply is empty.");
    const card = rules.card(body.cardId, command, "answered");
    await verb("card.message", await received(command, { id: card.id, text: body.text }, "text"));
    return card.id;
  }

  // The answer verb throws when the request isn't waiting any more. A grant is read before the answer clears the
  // request and written after it, so one that has gone leaves no grant behind.
  async function answer(command: CloudCommandRow): Promise<string> {
    const body = answerBody(command);
    if (!body) throw new Error("That answer is empty.");
    const card = rules.card(body.cardId, command, "answered");
    const problem = await rules.approve?.(command, body, card);
    if (problem) throw new Error(problem);
    const grant = answerGrant(body, card.pending);
    const { reply: said } = body;
    const replied = rules.questionReplies ? { annotations: said?.annotations, chat: said?.chat } : {};
    await rules.verb("card.permission.answer", { id: card.id, allow: body.allow, answers: body.answers, pendingId: body.pendingId, ...replied });
    if (grant) rules.grant(card.id, grant.directory, grant.scope);
    rules.after?.();
    return card.id;
  }

  async function stop(command: CloudCommandRow): Promise<string> {
    const body = stopBody(command);
    if (!body && rules.emptyStop) throw new Error(rules.emptyStop);
    const card = rules.card(body?.cardId, command, "stopped");
    await verb("card.stop", { id: card.id });
    return card.id;
  }

  // What remoteRefusal turns away runs only with a signed approval for exactly that change (args.widen), which also
  // stands in for the Mac's elevated rule over what it signed, and only that: the rest of the command (another mode in
  // the same card.update) still passes that rule, so an approval for a new agent can't carry an unsigned mode change.
  async function allowed(body: HostPayload, card: Card) {
    const refused = remoteRefusal(body);
    const change = refused ? widenChangeOf(body) : null;
    if (refused && change && rules.widen && body.args.widen !== undefined) {
      const problem = await rules.widen({ card: card.id, verb: body.verb, change, args: widenArgsOf(body.args) }, body.args.widen, refused);
      if (problem) throw new Error(problem);
      const rest = unsignedRest(body, change);
      const why = rest && (await rules.elevated?.(body.verb, rest));
      if (why) throw new Error(why);
      return;
    }
    const why = refused ?? (await rules.elevated?.(body.verb, body.args));
    if (why) throw new Error(why);
  }

  // Any verb in lib/host-api, on a card this host runs. Only a command its owner made gets this far, but anyone holding
  // that account's session can insert one, so remoteRefusal turns away what would widen the card.
  async function host(command: CloudCommandRow): Promise<HostDone> {
    const body = readHostCommand(command);
    if (body.verb === "card.permission.answer" && rules.answerAsKind) {
      const cardId = await answer(asAnswer(command, body));
      return { cardId, result: hostResult(cardId) };
    }
    if (isHostLevelVerb(body.verb)) return onHost(body);
    if (body.verb === "card.create") return create(command, body);
    if (isListVerb(body.verb)) return list(body.verb, body);
    const card = rules.card(body.args.id, command, "reached");
    if (OWNER_VERBS.has(body.verb) && !rules.fromOwner?.(command)) throw new Error(NOT_OWNER);
    await allowed(body, card);
    const reply = await verb(body.verb, await received(command, { ...withoutWiden(body.args), id: card.id }, textArgOf(body.verb)));
    // The card it touched, and for a read verb (skills.list) its answer; the editor's verbs answer with their value,
    // inline or as a blob when it's over the row's cap (lib/host-result.ts).
    const result = carriesValue(body.verb) ? await valueResult(card.id, reply, rules.carry) : verbResult(body.verb, card.id, reply);
    return { cardId: card.id, result };
  }

  // A verb on the host itself: no card to check, the same refusals, and the cardId left empty (reported as none).
  async function onHost(body: HostPayload): Promise<HostDone> {
    if (!rules.hostVerb) throw new Error(NO_HOST_VERBS);
    const refused = remoteRefusal(body);
    if (refused) throw new Error(refused);
    const reply = await rules.hostVerb(body.verb, body.args);
    return { cardId: "", result: verbResult(body.verb, "", reply) };
  }

  // A new card: no card to check yet, so the host's own create rule, behind the same refusals as an update.
  async function create(command: CloudCommandRow, body: HostPayload): Promise<HostDone> {
    if (!rules.create) throw new Error(NO_CREATE);
    const refused = remoteRefusal(body) ?? (await rules.elevated?.(body.verb, body.args));
    if (refused) throw new Error(refused);
    const cardId = await rules.create(command, await received(command, body.args, textArgOf(body.verb)));
    return { cardId, result: hostResult(cardId) };
  }

  // A cron or webhook the host keeps: args.id is the item, so there's no card to check, only remoteRefusal's limits. The
  // row's card_id stays empty (it may name only a card this host published); `result` names a run's card.
  async function list(verb: ListVerb, body: HostPayload): Promise<HostDone> {
    if (!rules.lists) throw new Error(NO_LISTS);
    const refused = remoteRefusal(body);
    if (refused) throw new Error(refused);
    const made = await rules.lists(verb, body.args);
    return { cardId: null, result: hostResult(made ?? "") };
  }

  return { reply, answer, stop, host };
}

// Runs a command's kind from the table. A newer board may send a kind this host doesn't know; `check` runs after the
// kind is known and before its handler (a Mac's author, folder and workspace checks).
export function dispatcher(table: KindTable, unknownKind: string, check?: (command: CloudCommandRow) => Promise<CloudCommandRow>) {
  return async (command: CloudCommandRow): Promise<Done> => {
    const kind: string = command.kind;
    if (!Object.hasOwn(table, kind)) throw new Error(unknownKind);
    const checked = check ? await check(command) : command;
    return (table[kind] as KindHandler)(checked);
  };
}
