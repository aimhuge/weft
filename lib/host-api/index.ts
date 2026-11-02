// The host API: one handler per verb, each a plain function of its args, mounted by every host. The desktop's
// Next server mounts it (the routes under app/api/cards/[id]/ are thin wrappers over runVerb), and so do the worker
// daemon and the cloud inbox, through one generic `host` command whose verb is looked up in HOST_API
// (lib/host-command.ts), so the table is also their allowlist. Imports here are relative: the daemon runs under
// jiti, which doesn't read the `@/` alias. `elevated` on a handler is the guard() / elevated() split of
// lib/guard.ts, read from one place by every host. See docs/architecture/project-hosts.md.
//
// Each handler's module loads on its first call, so a route pulls in only the code its own verbs run.
import { isHostVerb } from "@weft/client";
import { widens, type CardUpdateArgs } from "./calls";
import type { CreateArgs } from "./card-create";
import type { Handler, HostVerb } from "./types";

export { NotFound, requireCard, type Handler, type HostVerb } from "./types";
export { hostFail } from "./http";
export { messageCall, permissionCall, type CardPatch, type MessageBody, type PermissionBody } from "./calls";

type Fn = (args: never) => Promise<unknown>;

/** A handler's run that loads its module the first time it is called. */
function lazy<M, K extends keyof M>(load: () => Promise<M>, name: K): M[K] {
  return (async (args: never) => ((await load())[name] as Fn)(args)) as M[K];
}

export const HOST_API = {
  // A new thread, started or left in Backlog. Asking less than the default mode needs Weft's own window, as POST /api/cards.
  "card.create": {
    elevated: false,
    elevatedFor: ({ permissionMode }: CreateArgs) => permissionMode !== undefined && permissionMode !== "default",
    run: lazy(() => import("./card-create"), "createCardVerb"),
  },
  "card.update": {
    elevated: false,
    // A mode change or a read grant widens what the thread may do, so only those need Weft's own window.
    elevatedFor: ({ body }: CardUpdateArgs) => widens(body),
    run: lazy(() => import("./card-update"), "updateCardVerb"),
  },
  // Starts the card's CLI ahead of a reply; it changes nothing on the card.
  "card.warm": { elevated: false, run: lazy(() => import("./card-warm"), "warmCardVerb") },
  "card.stop": { elevated: false, run: lazy(() => import("./card-stop"), "stopCard") },
  // Deleting your own card narrows what it can touch, so a plain guard() is enough, as the DELETE route always had.
  "card.delete": { elevated: false, run: lazy(() => import("./card-delete"), "deleteCardVerb") },
  "card.shell": { elevated: true, run: lazy(() => import("./card-shell"), "shellCommand") },
  "card.fresh": { elevated: false, run: lazy(() => import("./card-fresh"), "sendFreshVerb") },
  "card.message": { elevated: false, run: lazy(() => import("./card-messages"), "sendMessageVerb") },
  "card.message.edit": { elevated: false, run: lazy(() => import("./card-messages"), "editMessageVerb") },
  "card.restart": { elevated: false, run: lazy(() => import("./card-messages"), "restartVerb") },
  "card.permission.answer": { elevated: true, run: lazy(() => import("./card-permission"), "answerVerb") },
  "card.permission.wait": { elevated: true, run: lazy(() => import("./card-permission"), "waitVerb") },
  "card.permission.first": { elevated: true, run: lazy(() => import("./card-permission"), "putFirstVerb") },
  "card.permission.otherFirst": { elevated: true, run: lazy(() => import("./card-permission"), "putOtherFirstVerb") },
  "card.switchBackend": { elevated: false, run: lazy(() => import("./card-cli"), "switchBackendVerb") },
  "card.rerunModel": { elevated: false, run: lazy(() => import("./card-cli"), "rerunModelVerb") },
  "card.stopTask": { elevated: false, run: lazy(() => import("./card-task"), "stopTaskVerb") },
  // Send later: a reply that waits on the host for its time, so it widens nothing a reply doesn't.
  "card.schedule": { elevated: false, run: lazy(() => import("./card-schedule"), "scheduleVerb") },
  "card.unschedule": { elevated: false, run: lazy(() => import("./card-schedule"), "unscheduleVerb") },
  // A read: the skills the card's folder has on that host, for the "/" typeahead.
  "skills.list": { elevated: false, run: lazy(() => import("./skills-list"), "skillsListVerb") },
  // The editor (H4). A save writes the folder, so it takes Weft's own window locally and is confined from the network.
  "files.list": { elevated: false, run: lazy(() => import("./files"), "listFilesVerb") },
  "files.read": { elevated: false, run: lazy(() => import("./files"), "readFileVerb") },
  "files.write": { elevated: true, run: lazy(() => import("./files"), "writeFileVerb") },
  // A card's dev server: a private address for it (a tunnel, after the owner's Touch ID on their Mac), or its end.
  "dev.open": { elevated: false, run: lazy(() => import("./dev-servers"), "devOpenVerb") },
  "dev.stop": { elevated: false, run: lazy(() => import("./dev-servers"), "devStopVerb") },
  // The same command again, and its last lines: neither widens what the card can touch.
  "dev.restart": { elevated: false, run: lazy(() => import("./dev-servers"), "devRestartVerb") },
  "dev.log": { elevated: false, run: lazy(() => import("./dev-servers"), "devLogVerb") },
} satisfies Record<HostVerb, Handler>;

type Table = typeof HOST_API;
export type ArgsOf<V extends HostVerb> = Parameters<Table[V]["run"]>[0];
export type ResultOf<V extends HostVerb> = Awaited<ReturnType<Table[V]["run"]>>;

// Whether a name is a verb HOST_API runs: @weft/client's check against HOST_VERBS, the names this table is keyed by.
export { isHostVerb };

/** Whether a call needs elevated() on the local host: the verb grants power, or grants it for these args. */
export function needsElevation<V extends HostVerb>(verb: V, args: ArgsOf<V>): boolean {
  const handler = HOST_API[verb] as Handler<ArgsOf<V>>;
  return handler.elevated || Boolean(handler.elevatedFor?.(args));
}

/** Runs one verb; a name that isn't in HOST_API is refused, which is what makes the table an allowlist. */
export async function runVerb<V extends HostVerb>(verb: V, args: ArgsOf<V>): Promise<ResultOf<V>> {
  if (!isHostVerb(verb)) throw new Error(`Unknown host verb: ${String(verb)}`);
  const handler = HOST_API[verb] as Handler<ArgsOf<V>, ResultOf<V>>;
  return handler.run(args);
}
