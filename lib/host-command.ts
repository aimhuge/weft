// The `host` command (docs/architecture/project-hosts.md#transports): one cloud_commands kind that carries any verb in
// lib/host-api, `{ verb, args }`, so a board reaches every verb a host runs without a new kind or a migration per
// feature. The board builds the row (hostCommand), the host reads it back (readHostCommand) and runs it with runVerb,
// then writes what came of it to the row's `result` (hostResult). The verb is looked up in HOST_API, so the table is
// the allowlist: a row can't name a verb the host doesn't have.
import type { CloudCommandRow, NewCommand } from "./cloud-commands";
import { isHostVerb, type HostVerb } from "./host-api";

// args always name the card the verb acts on; the rest is the verb's own (lib/host-api/calls.ts).
export type HostArgs = Record<string, unknown> & { id: string };

export interface HostPayload {
  verb: HostVerb;
  args: HostArgs;
}

// What a host writes to `result`. Never the card or its thread: those travel sealed (cloud_cards, the outbox), and
// the row is plain jsonb, so it says only whether the verb ran and which card it touched.
export type HostResult = { ok: true; cardId: string } | { ok: false; error: string };

type CardTarget = { orgId: string; device: string; folder: string; cardId: string };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

// The row a board inserts to run one verb on the host a card runs on. args.id is always the target's card, so a row
// can't be addressed to one card and act on another. Null for a verb no host runs.
export function hostCommand(target: CardTarget, verb: string, args: Record<string, unknown> = {}): NewCommand | null {
  if (!isHostVerb(verb)) return null;
  const payload: HostPayload = { verb, args: { ...args, id: target.cardId } };
  return { org_id: target.orgId, kind: "host", target_device: target.device, folder: target.folder, payload };
}

// A host command as a host reads it off the network: a verb it runs and args that name a card, or an error that says
// which is missing. card.update's body is the one shape a handler would otherwise trip over.
export function readHostCommand(command: Pick<CloudCommandRow, "payload">): HostPayload {
  const raw: unknown = command.payload;
  const p = isObject(raw) ? raw : {};
  if (typeof p.verb !== "string" || !p.verb) throw new Error("That request names no verb.");
  if (!isHostVerb(p.verb)) throw new Error(`This host doesn't run ${p.verb.slice(0, 60)}. Update it to the newest Weft.`);
  const args = isObject(p.args) ? p.args : {};
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

export function remoteRefusal({ verb, args }: HostPayload): string | null {
  if (verb === "card.shell") return "A shell command only runs from Weft's own window, not from the web.";
  const body = verb === "card.update" ? (args.body as Record<string, unknown> | undefined) : undefined;
  if (!body) return null;
  if (body.permissionMode === "bypassPermissions") return "A request from the web can't skip permission prompts. Pick that mode on the Mac.";
  const widening = WIDENING_FIELDS.find((field) => body[field] !== undefined);
  return widening ? `A request from the web can't change a card's ${widening === "cwd" ? "folder" : widening === "agent" ? "agent" : "read access"}. Do it in Weft's own window.` : null;
}

// A host command's outcome on the host that ran it: the card it touched, and what goes in the row's `result`.
export interface HostDone {
  cardId: string;
  result: HostResult;
}

export const isHostDone = (done: unknown): done is HostDone => Boolean(done) && typeof done === "object";

// What a verb's reply comes to in `result`: the card it touched, never the card itself.
export const hostResult = (cardId: string): HostResult => ({ ok: true, cardId });
export const hostFailure = (error: string): HostResult => ({ ok: false, error });

// The verbs whose text a person typed, and so may paste files (lib/attachment-transfer.ts): the arg that holds it.
const TEXT_ARGS: Partial<Record<HostVerb, string>> = { "card.message": "text", "card.message.edit": "text", "card.fresh": "message" };

export function textArgOf(verb: HostVerb): string | undefined {
  return TEXT_ARGS[verb];
}
