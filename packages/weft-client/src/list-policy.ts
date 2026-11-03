// What a host refuses, from the network, on the crons and webhooks it keeps (cron.*, webhook.*; host-command.ts
// remoteRefusal). The Mac's ⏰ and 🪝 drawers change a Weft Worker's through these verbs, but anyone holding the
// account's session can insert a row, so a row may only do what the drawers do: pause, rename, reschedule or re-word a
// cron, fire it now or delete it; mark a webhook registered, rename it, change its events or hint, or delete it. What
// would widen what runs there stays with a thread on that host: a cron's folder, CLI, mode or agent, a webhook's target,
// provider or signing secret. A "!" prompt is a shell line, so it never comes from the network.
import { isBang } from "./bang";
import type { ListVerb } from "./host-verbs";

type Kind = "string" | "boolean" | "number" | "strings";

// Each field a drawer may change, with the JSON type it must have.
export const CRON_PATCH_FIELDS: Readonly<Record<string, Kind>> = { name: "string", prompt: "string", expr: "string", mode: "string", enabled: "boolean", startsAt: "number", endsAt: "number" };
export const HOOK_PATCH_FIELDS: Readonly<Record<string, Kind>> = { name: "string", events: "strings", hint: "string", registered: "boolean" };

const CRON_MODES = new Set(["fork", "fresh"]);

export const BANG_CRON = "A cron whose prompt starts with “!” would run a shell line, so it only comes from a thread on that host, not from the web.";

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function fits(kind: Kind, value: unknown): boolean {
  if (kind === "strings") return Array.isArray(value) && value.every((v) => typeof v === "string");
  if (kind === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === kind;
}

function patchRefusal(what: "cron" | "webhook", fields: Readonly<Record<string, Kind>>, patch: unknown): string | null {
  if (!isObject(patch) || !Object.keys(patch).length) return "That change has nothing in it.";
  for (const [field, value] of Object.entries(patch)) {
    const kind = Object.hasOwn(fields, field) ? fields[field] : undefined;
    if (!kind) return `A request from the web can't change a ${what}'s ${field.slice(0, 40)}. Change it from a thread on that host.`;
    if (!fits(kind, value)) return `That ${what}'s ${field} isn't a ${kind === "strings" ? "list of names" : kind}.`;
  }
  return null;
}

/** Why a host refuses this list verb from the network, or null when it may run. */
export function listRefusal(verb: ListVerb, args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).find((k) => k !== "id" && k !== "patch");
  if (extra || (args.patch !== undefined && !verb.endsWith(".update"))) return `That request carries more than the ${verb.split(".")[0]} it names.`;
  if (verb === "cron.update") {
    const refused = patchRefusal("cron", CRON_PATCH_FIELDS, args.patch);
    if (refused) return refused;
    const patch = args.patch as Record<string, unknown>;
    if (typeof patch.prompt === "string" && isBang(patch.prompt)) return BANG_CRON;
    if (patch.mode !== undefined && !CRON_MODES.has(patch.mode as string)) return "A cron's runs are fork or fresh.";
    return null;
  }
  return verb === "webhook.update" ? patchRefusal("webhook", HOOK_PATCH_FIELDS, args.patch) : null;
}

// What a cron made from a card (cron.create) may carry from the network: what the ⏰ popover sends. Its folder, CLI,
// model, effort, mode and agent are the card's own, read on the host, never the row's; the host narrows the mode
// (lib/worker-kinds.ts listVerb).
export const CRON_CREATE_FIELDS: Readonly<Record<string, Kind>> = {
  prompt: "string",
  expr: "string",
  name: "string",
  mode: "string",
  fromMessage: "string",
  enabled: "boolean",
  startsAt: "number",
  endsAt: "number",
  runNow: "boolean",
};

/** Why a host refuses a cron.create from the network, or null when it may run. args.id is the card. */
export function cronCreateRefusal(args: Record<string, unknown>): string | null {
  const input = Object.fromEntries(Object.entries(args).filter(([key]) => key !== "id"));
  const refused = patchRefusal("cron", CRON_CREATE_FIELDS, input);
  if (refused) return refused;
  if (typeof input.prompt !== "string" || typeof input.expr !== "string") return "A cron needs a prompt and a schedule.";
  if (isBang(input.prompt)) return BANG_CRON;
  return input.mode !== undefined && !CRON_MODES.has(input.mode as string) ? "A cron's runs are fork or fresh." : null;
}
