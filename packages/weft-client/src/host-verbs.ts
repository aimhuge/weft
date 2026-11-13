// Every verb a host runs (docs/architecture/project-hosts.md): the names, apart from the handlers in lib/host-api, so
// a board, weft.zip or the phone can build a `host` command without loading a handler. lib/host-api's HOST_API is
// keyed by exactly these (`satisfies Record<HostVerb, Handler>`), so a verb added there without a name here, or the
// other way round, fails the type check.
export const HOST_VERBS = [
  "card.create",
  "card.update",
  "card.warm",
  "card.stop",
  "card.delete",
  "card.shell",
  "card.fresh",
  "card.message",
  "card.message.edit",
  "card.restart",
  "card.permission.answer",
  "card.permission.wait",
  "card.permission.first",
  "card.permission.otherFirst",
  "card.switchBackend",
  "card.rerunModel",
  "card.stopTask",
  "card.schedule",
  "card.unschedule",
  "skills.list",
  // The editor (H4): a folder's index, one file, a save.
  "files.list",
  "files.read",
  "files.write",
  // Live reload over a session line: the line watches a file a read may open, and drops it.
  "files.watch",
  "files.unwatch",
  // A host's own settings (./host-settings.ts), for no card: elevated, and only HOST_SETTINGS.
  "settings.get",
  "settings.put",
  "dev.open",
  "dev.stop",
  // A cron made from a card (lib/host-api/cron-create.ts): args.id is the card, whose folder and CLI each run takes.
  "cron.create",
  // The crons and webhooks a host keeps (lib/host-api/lists.ts): args.id names the item, not a card.
  "cron.update",
  "cron.delete",
  "cron.run",
  "webhook.update",
  "webhook.delete",
  // T5: the Services drawer's Restart and Log on a worker's dev server.
  "dev.restart",
  "dev.log",
  // H1: the review tour's dev server (its plan's command, and whether it answers).
  "dev.start",
  "dev.status",
  // H1: reads. card.list is the host's cards (host-level: it names no card); thread.* read one card's thread.
  "card.list",
  "thread.page",
  "thread.search",
  "thread.tool",
  // A project's uncommitted work as a snapshot on a hidden ref, for another machine to pick up (lib/wip-snapshot.ts).
  // Host-level: it names a project folder, not a card.
  "tree.snapshot",
] as const;

/** Every verb a host runs. HOST_API is keyed by these, and it is the allowlist a remote host checks. */
export type HostVerb = (typeof HOST_VERBS)[number];

const VERBS: ReadonlySet<string> = new Set(HOST_VERBS);

export function isHostVerb(verb: string): verb is HostVerb {
  return VERBS.has(verb);
}

// The verbs that act on the host itself rather than a card: their row names no card, and a host runs them only when
// its CardRules say it takes them from the network (a worker does; a Mac's settings stay in its own window, and its
// cards reach a board through its own sync). card.list reads the host's cards rather than one of them.
export type HostLevelVerb = "settings.get" | "settings.put" | "card.list" | "tree.snapshot";
/** The verbs that act on a card: every one but the host-level ones. */
export type CardVerb = Exclude<HostVerb, HostLevelVerb>;
const HOST_LEVEL: ReadonlySet<string> = new Set<HostLevelVerb>(["settings.get", "settings.put", "card.list", "tree.snapshot"]);

export function isHostLevelVerb(verb: string): boolean {
  return HOST_LEVEL.has(verb);
}

/** The verbs on a host's own crons and webhooks, whose args.id is the item's id there rather than a card's. cron.create
 * isn't one: it names the card the cron is made from. */
export type ListVerb = Exclude<Extract<HostVerb, `cron.${string}` | `webhook.${string}`>, "cron.create">;

export function isListVerb(verb: string): verb is ListVerb {
  return isHostVerb(verb) && verb !== "cron.create" && (verb.startsWith("cron.") || verb.startsWith("webhook."));
}
