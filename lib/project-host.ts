"use client";

// A project's host: the machine that holds its checkout and runs its cards (docs/architecture/project-hosts.md). The
// board asks `hostFor(project)` and gets one interface whichever it is: this Mac (LocalHost, the local server's card
// routes) or a Weft Worker (CloudHost, a `host` command through /api/worker-board). `.thread` is the open thread's
// transport, `.tools` where a trimmed tool output comes from, `.act` runs one host-api verb on the card, `.can` says
// which of this Mac's own features the host has, and `.menu` trims a card's right-click menu to what it backs. The
// board never asks whether a card is a worker's: the worker:// check lives here and in lib/worker-project.ts.
import { api, call, type NewCardInput } from "./client";
import { filesApi } from "./client-files";
import { cronApi } from "./cron-client";
import type { CronInput, CronPatch } from "./cron-types";
import type { FilesSource } from "./files-source";
import { localRead, type ReadProject } from "./project-reads";
import { cloudRead } from "./project-snapshot-view";
import { remoteMenu } from "./card-menu-remote";
import type { MenuItem } from "./card-menu";
import type { ArgsOf } from "./host-api";
import type { CardVerb as HostVerb } from "@weft/client";
import type { HostArgs } from "./host-command";
import { localTransport, type ThreadTransport } from "./thread-transport";
import type { Backend, Card, QuestionReply } from "./types";
import type { WebhookPatch } from "./webhook-types";
import { localToolSource, type ToolResultSource } from "./use-tool-result";
import type { ActResult } from "./worker-acts";
import { workerFiles } from "./worker-files";
import { actOnWorker, workerToolSource, workerTransport } from "./worker-transport";
import { parseWorkerProject } from "./worker-project";
import { actOnLine, lineFiles, lineTransport, warmOnLine } from "./line-host";
import { canSignWiden } from "./widen-signer";
import { teamHostOf } from "./team-host";

// This Mac's own features, which another host offers only once it has a verb or a stream for them. `files` is the
// editor and the thread's file links (H4), `shots` the show rail's page pictures (lib/page-shots.ts), `pane` the native
// browser pane; `folder`, `agent`, `shell` and `terminal` widen what a card can touch, so a remote host takes them only
// with a signed approval.
// `skills` is the skill set chip (which skills a card gets); the "/" list is the transport's listSkills on every host.
// `runSkill` is the header's Skills menu, which sends "/<skill>" as a message (the list from skills.list).
// `schedule` is Send later, which both hosts hold the timer for (card.schedule). `reads` is the header badges (H4);
// `projectActs` what they start from this Mac's store and server: a re-scout, the commit walk-through and the sprint
// plan, whose prompts point at the Mac's own routes. `cron` is the header's ⏰, this Mac's crons; `settings` says this
// Mac's Settings (the backup model) speak for the card. `share` a weft.zip link to the card's cloud rows; `delete` card.delete.
// `lists` is the ⏰ and 🪝 drawers' changes to a cron or webhook the host keeps (cron.*, webhook.*); `relay` a webhook's
// public URL and tunnel from the 🪝 drawer, and adding one by hand there, which are this Mac's (a worker's threads do it).
// `terminal` is the terminal drawer, a pty on the host (on a worker, over its session line).
export type HostFeature =
  | "files" | "reads" | "projectActs" | "shots" | "pane" | "folder" | "agent" | "shell" | "terminal" | "skills" | "runSkill" | "share" | "delete" | "login" | "vault" | "dev" | "schedule" | "cron" | "settings" | "lists" | "relay";

export interface ProjectHost {
  kind: "local" | "cloud";
  // The Weft Worker this host is, for reads keyed by it (its model caps, lib/use-plan-limits.ts); none on this Mac.
  workerId?: string;
  thread: ThreadTransport;
  tools: ToolResultSource;
  can: (feature: HostFeature) => boolean;
  // The header badges' reads of a project (lib/project-reads.ts), and the editor's files (lib/files-source.ts).
  read: ReadProject;
  files: FilesSource;
  // Runs one verb on the card args.id names. `local` is the call this Mac's board has always made for it, when a
  // caller has its own (api.mark for a star); a remote host ignores it.
  // A worker that hasn't taken it yet answers `{ queued }` (lib/worker-acts.ts); this Mac always answers at once.
  act: <V extends HostVerb>(verb: V, args: ArgsOf<V>, local?: () => Promise<unknown>) => Promise<ActResult>;
  menu: (items: MenuItem[]) => MenuItem[];
  // Starts an open card's CLI ahead of a reply, best effort: this Mac's /api/warm; a worker only over its session line
  // when that's up, so opening a card never costs a command row.
  warm: (cardId: string) => void;
}

type LocalCall = (args: HostArgs) => Promise<unknown>;
const text = (v: unknown) => (typeof v === "string" ? v : "");
// Trailing args left out stay out, so a call reads as the route's own callers make it.
const given = <T extends unknown[]>(...args: T) => {
  while (args.length && args[args.length - 1] === undefined) args.pop();
  return args;
};

// thread.page's before and limit, as the route's query: only the ones given.
const pageQuery = (a: HostArgs): Record<string, string> =>
  Object.fromEntries((["before", "limit"] as const).filter((k) => typeof a[k] === "number").map((k) => [k, String(a[k])]));

// Each verb as the local server's card routes take it (lib/client-api.ts), the routes that mount the same handlers.
const LOCAL: Record<HostVerb, LocalCall> = {
  // The board's own New thread goes through POST /api/cards; this is the verb's local form, the id the server's to pick.
  "card.create": (a) => api.create(Object.fromEntries(Object.entries(a).filter(([k]) => k !== "id")) as unknown as NewCardInput),
  "card.warm": (a) => api.warm({ cardId: a.id }),
  "card.update": (a) => call("PATCH", `/api/cards/${a.id}`, a.body),
  "card.stop": (a) => api.stop(a.id),
  "card.delete": (a) => api.remove(a.id),
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
  "files.list": (a) => filesApi.list(a.id),
  "files.read": (a) => (a.at === "HEAD" ? filesApi.head(a.id, text(a.path)) : filesApi.read(a.id, text(a.path))),
  // This Mac's editor polls its own files (lib/use-open-file.ts): a watch is only the file's hash now.
  "files.watch": (a) => filesApi.read(a.id, text(a.path)).then((f) => ({ path: f.path, hash: f.hash })),
  "files.unwatch": (a) => Promise.resolve({ path: text(a.path) }),
  "files.write": (a) => filesApi.write(a.id, text(a.path), text(a.text), a.baseHash as string | null | undefined),
  "dev.open": (a) => call("POST", `/api/cards/${a.id}/dev`, { action: "open" }),
  "dev.stop": (a) => api.devAction(a.id, "stop"),
  // The ⏰ popover's POST /api/crons, from the card a.id names.
  "cron.create": ({ id, ...input }) => cronApi.create({ ...(input as Omit<CronInput, "cardId">), cardId: id }),
  // The ⏰ and 🪝 drawers' routes (lib/cron-client.ts, lib/client-api.ts); a.id is the cron's or webhook's.
  "cron.update": (a) => cronApi.update(a.id, a.patch as CronPatch),
  "cron.delete": (a) => cronApi.remove(a.id),
  "cron.run": (a) => cronApi.run(a.id),
  "webhook.update": (a) => api.updateWebhook(a.id, a.patch as WebhookPatch),
  "webhook.delete": (a) => api.removeWebhook(a.id),
  "dev.restart": (a) => call("POST", `/api/cards/${a.id}/dev`, { action: "rerun" }),
  "dev.log": (a) => call("POST", `/api/cards/${a.id}/dev`, { action: "log" }),
  "dev.start": (a) => api.devAction(a.id, a.restart === true ? "restart" : "start"),
  "dev.status": (a) => api.devStatus(a.id),
  // The thread's reads, through their routes (lib/host-api/thread.ts).
  "thread.page": (a) => call("GET", `/api/cards/${a.id}/thread?${new URLSearchParams(pageQuery(a)).toString()}`),
  "thread.search": (a) => call("GET", `/api/cards/${a.id}/thread/search?q=${encodeURIComponent(text(a.q))}`),
  "thread.tool": (a) => call("GET", `/api/cards/${a.id}/thread/tool/${encodeURIComponent(text(a.toolId))}`),
};

export const localHost: ProjectHost = {
  kind: "local",
  thread: localTransport,
  tools: localToolSource,
  can: () => true,
  read: localRead,
  files: filesApi,
  act: async (verb, args, local) => {
    await (local ? local() : LOCAL[verb](args));
    return undefined;
  },
  menu: (items) => items,
  warm: (cardId) => void api.warm({ cardId }).catch(() => {}),
};

// What a Worker has today: its cards' own verbs, the thread and its pages, Send later, a skill run as a message, its
// files through the file verbs and the header's reads through its snapshots (H4). Share… reads the card's cloud rows,
// which a worker publishes like a Mac's outbox (lib/card-share-worker.ts), and Delete is card.delete. Its crons and
// webhooks change from the Mac's drawers (lists), and its ⏰ makes a cron there (cron.create). Its skill set chip lists
// the worker's own skills and sets the card's through card.update. Not this Mac's pane, vault or CLIs.
const CLOUD_FEATURES = new Set<HostFeature>(["schedule", "files", "reads", "runSkill", "share", "delete", "lists", "cron", "skills"]);
// What widens a card, which a worker runs only with a signed approval (lib/widen-signer.ts): offered where this Mac can
// sign one (the desktop app), and the act asks Touch ID first.
const SIGNED_FEATURES = new Set<HostFeature>(["folder", "agent", "shell", "terminal"]);

export const cloudHost: ProjectHost = {
  kind: "cloud",
  thread: workerTransport,
  tools: workerToolSource,
  can: (feature) => CLOUD_FEATURES.has(feature) || (SIGNED_FEATURES.has(feature) && canSignWiden()),
  read: cloudRead,
  files: workerFiles,
  act: (verb, args) => actOnWorker(verb, args),
  menu: (items) => remoteMenu(items, canSignWiden() ? { agent: true, skip: true } : {}),
  warm: () => {},
};

// A worker's host takes its session line when it's up and the relay when it isn't (lib/line-host.ts).
const cloudHosts = new Map<string, ProjectHost>();
function cloudHostOf(workerId: string): ProjectHost {
  let host = cloudHosts.get(workerId);
  if (!host) cloudHosts.set(workerId, (host = { ...cloudHost, workerId, thread: lineTransport(workerId), files: lineFiles(workerId), act: (verb, args) => actOnLine(workerId, verb, args), warm: (id) => warmOnLine(workerId, id) }));
  return host;
}

// weft.zip's board (components/web-board/useWebHost.ts) runs on no Mac: every card there is another machine's, a Mac's
// inbox or a worker's daemon, whatever its folder looks like. While it's set, every card's host is that one.
let everyCard: ProjectHost | null = null;

// Puts one host in front of every card, or (null) takes it away; answers the way to take it back.
export function setHostForEveryCard(host: ProjectHost | null): () => void {
  everyCard = host;
  return () => {
    if (everyCard === host) everyCard = null;
  };
}

// The host of a project (a folder, or a worker:// path); no project is this Mac's.
export function hostFor(project: string | null | undefined): ProjectHost {
  if (everyCard) return everyCard;
  const worker = project ? parseWorkerProject(project) : null;
  return worker ? cloudHostOf(worker.workerId) : localHost;
}

// A teammate's card (Card.team, lib/team-board.ts) sits in your own project's folder but runs on their Mac: its host is
// the read-only one, whatever its folder says (lib/team-host.ts).
export const hostOf = (card: Pick<Card, "cwd" | "team">) => (card.team && !everyCard ? teamHostOf(card.team) : hostFor(card.cwd));

// Whether an open card's panel offers a feature: its transport reaches the card's host (this Mac's always, a worker's
// card edits too; never weft.zip's) and that host has it.
export const cardCan = (card: Pick<Card, "cwd" | "team">, transport: Pick<ThreadTransport, "desktop" | "cardEdits">, feature: HostFeature) =>
  (transport.desktop || Boolean(transport.cardEdits)) && hostOf(card).can(feature);

// The cards whose plan readings say when the card's own CLI plan resets (Send later's default times, lib/schedule.ts):
// on this Mac every card, as always; on a worker only that worker's, which run on its own sign-in, not this Mac's.
export function sameHostCards(cards: Card[], card: Pick<Card, "cwd">): Card[] {
  const worker = parseWorkerProject(card.cwd)?.workerId;
  if (!worker) return cards;
  return cards.filter((c) => parseWorkerProject(c.cwd)?.workerId === worker);
}
