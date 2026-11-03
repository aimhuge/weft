// The `host` command (docs/architecture/project-hosts.md#transports): one cloud_commands kind that carries any verb in
// lib/host-api, `{ verb, args }`, so a board reaches every verb a host runs without a new kind or a migration per
// feature. The board builds the row (hostCommand), the host reads it back (readHostCommand) and runs it with runVerb,
// then writes what came of it to the row's `result` (hostResult). The verb is looked up in HOST_API, so the table is
// the allowlist: a row can't name a verb the host doesn't have. lib/host-command.ts re-exports it.
import { isBang } from "./bang";
import type { SkillInfo } from "./card";
import { hostRow, type CardTarget, type HostCommandRow, type HostPayload } from "./host-row";
import { readRefusal, writeRefusal } from "./file-policy";
import { foreignSetting, type HostSettings } from "./host-settings";
import { isHostLevelVerb, isHostVerb, isListVerb, type HostVerb } from "./host-verbs";
import { listRefusal } from "./list-policy";
import { fitSkills, type SkillsOnWire } from "./skills-wire";

// What a host writes to `result`. Never the card or its thread: those travel sealed (cloud_cards, the outbox), and
// the row is plain jsonb, so it says whether the verb ran and which card it touched, plus what a read verb answers
// (RESULTS below), kept small enough for the column's 4 KB cap.
// A verb that answers with a value too big for that (the editor's files.*) adds it as `value` when it's small, else
// `blob`, the sha of its JSON in the workspace's blob store (lib/host-result.ts). address: dev.open's private /t/<id>
// address for the card's dev server. log: dev.log's last lines of it. A host-level verb (settings.get / settings.put)
// touched no card: its cardId is "".
export type HostResult =
  | ({ ok: true; cardId: string; value?: unknown; blob?: string; address?: string; log?: string } & Partial<SkillsOnWire> & { settings?: HostSettings })
  | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// The row a board inserts to run one verb on the host a card runs on. args.id is always the target's card, so a row
// can't be addressed to one card and act on another. Null for a verb no host runs.
export function hostCommand(target: CardTarget, verb: string, args: Record<string, unknown> = {}): HostCommandRow | null {
  return isHostVerb(verb) ? hostRow(target, verb, args) : null;
}

// A host command as a host reads it off the network: a verb it runs and args that name a card, or an error that says
// which is missing. card.update's body is the one shape a handler would otherwise trip over.
export function readHostCommand(command: { payload: unknown }): HostPayload {
  const raw: unknown = command.payload;
  const p = isObject(raw) ? raw : {};
  if (typeof p.verb !== "string" || !p.verb) throw new Error("That request names no verb.");
  if (!isHostVerb(p.verb)) throw new Error(`This host doesn't run ${p.verb.slice(0, 60)}. Update it to the newest Weft.`);
  const args = isObject(p.args) ? p.args : {};
  // A verb on the host itself names no card; its id is "" whatever the row says, so it can't reach one.
  if (isHostLevelVerb(p.verb)) return { verb: p.verb, args: { ...args, id: "" } };
  if (typeof args.id !== "string" || !args.id) throw new Error("That request names no card.");
  if (p.verb === "card.update" && !isObject(args.body)) throw new Error("That update has no changes.");
  return { verb: p.verb, args: { ...args, id: args.id } };
}

// What a host off the network refuses on top of the verb's own checks: a thread that runs without asking. The Mac's
// own window can pick it (the PATCH route, behind elevated()); a row from weft.zip or the phone can't, as `run` and
// `mode` can't (lib/worker-commands.ts RUN_MODES, CARD_MODES).
// What a command from the network may never do, on either host: anything that widens what a card can touch. The
// session that inserts a row isn't trusted (mobile-security.md), so a shell, a card moved to another folder, a new agent
// or a wider read scope only come from Weft's own window, where the local routes check elevated().
const WIDENING_FIELDS = ["cwd", "agent", "readScope"] as const;

const SHELL_REFUSED = "A shell command only runs from Weft's own window, not from the web.";

export function remoteRefusal({ verb, args }: HostPayload): string | null {
  if (verb === "card.shell") return SHELL_REFUSED;
  // Only a host's own settings come from the network: never its folders, modes or guards.
  const foreign = verb === "settings.put" ? foreignSetting(args.patch) : null;
  if (foreign) return `A request from the web can't change ${foreign.slice(0, 40)}. Do it in Weft's own window on that machine.`;
  // A cron or webhook the host keeps: only what the Mac's drawers change (./list-policy.ts).
  if (isListVerb(verb)) return listRefusal(verb, args);
  // A scheduled message is sent as a reply when its time comes, never run, but a "!" one would read as a command
  // waiting to run, so the network can't leave one on a card at all.
  if (verb === "card.schedule" && typeof args.text === "string" && isBang(args.text)) return SHELL_REFUSED;
  // The editor stays inside the card's folder (lib/file-access.ts), off credentials and .git, and a save off what
  // configures its agent: what the card's own thread could do when asked, never what would widen it (./file-policy.ts).
  if (verb === "files.read" || verb === "files.watch" || verb === "files.write") {
    if (typeof args.path !== "string") return "That names no file.";
    return verb === "files.write" ? writeRefusal(args.path) : readRefusal(args.path);
  }
  return cardFieldsRefusal(verb, args);
}

// A card update's body, or a new card's fields (card.create, its folder the row's own): no skipped prompts, and nothing
// that moves the card's folder, agent or read scope.
function cardFieldsRefusal(verb: HostPayload["verb"], args: HostPayload["args"]): string | null {
  const body = verb === "card.update" ? (args.body as Record<string, unknown> | undefined) : verb === "card.create" ? args : undefined;
  if (!body) return null;
  if (body.permissionMode === "bypassPermissions") return "A request from the web can't skip permission prompts. Pick that mode on the Mac.";
  const widening = WIDENING_FIELDS.find((field) => body[field] !== undefined);
  return widening ? `A request from the web can't change a card's ${widening === "cwd" ? "folder" : widening === "agent" ? "agent" : "read access"}. Do it in Weft's own window.` : null;
}

// A host command's outcome on the host that ran it: the card it touched, and what goes in the row's `result`.
export interface HostDone {
  // Null for a verb on a cron or webhook (cron.*, webhook.*): the row's card_id names only a card the host published.
  cardId: string | null;
  result: HostResult;
}

export const isHostDone = (done: unknown): done is HostDone => Boolean(done) && typeof done === "object";

// What a verb's reply comes to in `result`: the card it touched, never the card itself.
export const hostResult = (cardId: string): HostResult => ({ ok: true, cardId });

// The verbs a board runs for their answer, and the part of it that goes in `result`.
const settingsOf = (reply: unknown) => {
  const settings = (reply as { settings?: HostSettings } | undefined)?.settings;
  return settings ? { settings } : {};
};
const RESULTS: Partial<Record<HostVerb, (reply: unknown) => Partial<SkillsOnWire> & { settings?: HostSettings } & { address?: string } & { log?: string }>> = {
  "skills.list": (reply) => fitSkills((reply as { skills?: SkillInfo[] } | undefined)?.skills ?? []),
  "settings.get": settingsOf,
  "settings.put": settingsOf,
  "dev.open": (reply) => {
    const address = (reply as { address?: unknown } | undefined)?.address;
    return typeof address === "string" ? { address: address.slice(0, 500) } : {};
  },
  // A dev server's last lines, the end kept: the row's result is capped at 4 KB.
  "dev.log": (reply) => {
    const log = (reply as { log?: unknown } | undefined)?.log;
    return typeof log === "string" ? { log: tailBytes(log, DEV_LOG_MAX) } : {};
  },
};

// How much of a dev server's log a `dev.log` result carries, in UTF-8 bytes.
export const DEV_LOG_MAX = 2_500;

// The end of a text that fits in `max` UTF-8 bytes: a log's newest lines matter, and a wide character counts as 2 to 4.
export function tailBytes(text: string, max: number): string {
  const bytes = (t: string) => new TextEncoder().encode(t).length;
  let out = text.slice(-max);
  while (bytes(out) > max) out = out.slice(Math.max(1, Math.ceil((bytes(out) - max) / 4)));
  return out;
}

// `result` for a verb that ran: the card, and for a read verb its answer.
export function verbResult(verb: HostVerb, cardId: string, reply: unknown): HostResult {
  const answer = RESULTS[verb];
  return answer ? { ...hostResult(cardId), ...answer(reply) } : hostResult(cardId);
}
export const hostFailure = (error: string): HostResult => ({ ok: false, error });

// The verbs whose text a person typed, and so may paste files (lib/attachment-transfer.ts): the arg that holds it.
const TEXT_ARGS: Partial<Record<HostVerb, string>> = { "card.create": "prompt", "card.message": "text", "card.message.edit": "text", "card.fresh": "message", "card.schedule": "text" };

export function textArgOf(verb: HostVerb): string | undefined {
  return TEXT_ARGS[verb];
}
