"use client";

// A project's host: the machine that holds its checkout and runs its cards (docs/architecture/project-hosts.md). The
// board asks `hostFor(project)` and gets one interface whichever it is: this Mac (LocalHost, the local server's card
// routes) or a Weft Worker (CloudHost, a `host` command through /api/worker-board). `.thread` is the open thread's
// transport, `.tools` where a trimmed tool output comes from, `.act` runs one host-api verb on the card, `.can` says
// which of this Mac's own features the host has, and `.menu` trims a card's right-click menu to what it backs. The
// board never asks whether a card is a worker's: the worker:// check lives here and in lib/worker-project.ts.
import { api, call } from "./client";
import { remoteMenu } from "./card-menu-remote";
import type { MenuItem } from "./card-menu";
import type { ArgsOf } from "./host-api";
import type { HostVerb } from "./host-api/types";
import type { HostArgs } from "./host-command";
import { localTransport, type ThreadTransport } from "./thread-transport";
import type { Backend, Card, QuestionReply } from "./types";
import { localToolSource, type ToolResultSource } from "./use-tool-result";
import type { ActResult } from "./worker-acts";
import { actOnWorker, workerToolSource, workerTransport } from "./worker-transport";
import { parseWorkerProject } from "./worker-project";
import { actOnLine, lineTransport } from "./line-host";

// This Mac's own features, which another host offers only once it has a verb or a stream for them. `files` is the
// editor and the thread's file links (H4), `shots` the show rail's page pictures (lib/page-shots.ts), `pane` the native
// browser pane; `folder`, `agent` and `shell` widen what a card can touch, so a remote host refuses them from the network.
// `skills` is the skill set chip (which skills a card gets); the "/" list is the transport's listSkills on every host.
// `schedule` is Send later, which both hosts hold the timer for (card.schedule).
export type HostFeature = "files" | "shots" | "pane" | "folder" | "agent" | "shell" | "skills" | "share" | "delete" | "login" | "vault" | "dev" | "schedule";

export interface ProjectHost {
  kind: "local" | "cloud";
  thread: ThreadTransport;
  tools: ToolResultSource;
  can: (feature: HostFeature) => boolean;
  // Runs one verb on the card args.id names. `local` is the call this Mac's board has always made for it, when a
  // caller has its own (api.mark for a star); a remote host ignores it.
  // A worker that hasn't taken it yet answers `{ queued }` (lib/worker-acts.ts); this Mac always answers at once.
  act: <V extends HostVerb>(verb: V, args: ArgsOf<V>, local?: () => Promise<unknown>) => Promise<ActResult>;
  menu: (items: MenuItem[]) => MenuItem[];
}

type LocalCall = (args: HostArgs) => Promise<unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");
// Trailing args left out stay out, so a call reads as the route's own callers make it.
const given = <T extends unknown[]>(...args: T) => {
  while (args.length && args[args.length - 1] === undefined) args.pop();
  return args;
};

// Each verb as the local server's card routes take it (lib/client-api.ts), the routes that mount the same handlers.
const LOCAL: Record<HostVerb, LocalCall> = {
  "card.update": (a) => call("PATCH", `/api/cards/${a.id}`, a.body),
  "card.stop": (a) => api.stop(a.id),
  "card.shell": (a) => api.shell(a.id, text(a.command)),
  "card.fresh": (a) => api.fresh(a.id, text(a.message)),
  "card.message": (a) => api.send(a.id, text(a.text)),
  "card.message.edit": (a) => api.editLast(a.id, text(a.text)),
  "card.restart": (a) => api.restart(a.id),
  "card.permission.answer": (a) =>
    api.answer(a.id, a.allow === true, a.answers as Record<string, string> | undefined, a.pendingId as string | undefined, a.reply as QuestionReply | undefined),
  "card.permission.wait": (a) => api.waitPermission(a.id, text(a.pendingId)),
  "card.permission.first": (a) => api.putFirst(a.id, text(a.pendingId)),
  "card.permission.otherFirst": (a) => api.putHolderFirst(a.id, text(a.pendingId)),
  "card.switchBackend": (a) => api.switchBackend(a.id, a.backend as Backend, ...given(a.replay as boolean | undefined, a.model as string | undefined)),
  "card.rerunModel": (a) => api.rerunModel(a.id, text(a.model)),
  "card.stopTask": (a) => api.stopTask(a.id, text(a.taskId)),
  "card.schedule": (a) => api.schedule(a.id, text(a.text), Number(a.at)),
  "card.unschedule": (a) => api.unschedule(a.id, text(a.messageId)),
  "skills.list": (a) => call("GET", `/api/skills?card=${encodeURIComponent(a.id)}`),
};

export const localHost: ProjectHost = {
  kind: "local",
  thread: localTransport,
  tools: localToolSource,
  can: () => true,
  act: async (verb, args, local) => {
    await (local ? local() : LOCAL[verb](args));
    return undefined;
  },
  menu: (items) => items,
};

// What a Worker has today: its cards' own verbs, the thread and its pages. Not this Mac's files, pane, vault or CLIs.
const CLOUD_FEATURES = new Set<HostFeature>(["schedule"]);

export const cloudHost: ProjectHost = {
  kind: "cloud",
  thread: workerTransport,
  tools: workerToolSource,
  can: (feature) => CLOUD_FEATURES.has(feature),
  act: (verb, args) => actOnWorker(verb, args),
  menu: remoteMenu,
};

// A worker's host takes its session line when it's up and the relay when it isn't (lib/line-host.ts).
const cloudHosts = new Map<string, ProjectHost>();
function cloudHostOf(workerId: string): ProjectHost {
  let host = cloudHosts.get(workerId);
  if (!host) cloudHosts.set(workerId, (host = { ...cloudHost, thread: lineTransport(workerId), act: (verb, args) => actOnLine(workerId, verb, args) }));
  return host;
}

// The host of a project (a folder, or a worker:// path); no project is this Mac's.
export function hostFor(project: string | null | undefined): ProjectHost {
  const worker = project ? parseWorkerProject(project) : null;
  return worker ? cloudHostOf(worker.workerId) : localHost;
}

export const hostOf = (card: Pick<Card, "cwd">) => hostFor(card.cwd);

// The cards whose plan readings say when the card's own CLI plan resets (Send later's default times, lib/schedule.ts):
// on this Mac every card, as always; on a worker only that worker's, which run on its own sign-in, not this Mac's.
export function sameHostCards(cards: Card[], card: Pick<Card, "cwd">): Card[] {
  const worker = parseWorkerProject(card.cwd)?.workerId;
  if (!worker) return cards;
  return cards.filter((c) => parseWorkerProject(c.cwd)?.workerId === worker);
}
