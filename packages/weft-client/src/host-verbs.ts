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
  "dev.open",
  "dev.stop",
  // T5: the Services drawer's Restart and Log on a worker's dev server.
  "dev.restart",
  "dev.log",
] as const;

/** Every verb a host runs. HOST_API is keyed by these, and it is the allowlist a remote host checks. */
export type HostVerb = (typeof HOST_VERBS)[number];

const VERBS: ReadonlySet<string> = new Set(HOST_VERBS);

export function isHostVerb(verb: string): verb is HostVerb {
  return VERBS.has(verb);
}
