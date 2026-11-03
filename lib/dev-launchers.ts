import path from "node:path";
import { detectDevCommands } from "./dev-commands";
import { devStatus, reachable, restartDev, runs, startDev, type Run } from "./devserver";
import { listCards } from "./store";
import type { Card, DevLauncher, LauncherCommand, ServiceState } from "./types";

// The Services drawer's Dev servers section: each working folder (an open card's) with the commands
// that start its dev server (lib/dev-commands.ts), and Start or Restart for each. A start goes through
// the same runs as mcp__devservers__start (lib/devserver.ts), keyed `folder:<cwd>`, so the Services
// list shows it like any other, and a server a card already runs is restarted rather than started twice.

export const folderKey = (cwd: string) => `folder:${cwd}`;

// Open cards' folders, most recently used first. Weft's own folder is left out: its dev server is the
// one serving this board, and starting another would clash with it.
export function workingFolders(cards: readonly Card[], self = process.cwd()): string[] {
  const own = path.resolve(/*turbopackIgnore: true*/ self);
  const folders = cards.filter((c) => !c.archived && c.cwd && path.resolve(c.cwd) !== own).map((c) => path.resolve(c.cwd));
  return [...new Set(folders)];
}

// The run serving this command in this folder: a live one first, else the last one that ended.
export function runFor(cwd: string, command: string): { key: string; run: Run } | undefined {
  let ended: { key: string; run: Run } | undefined;
  for (const [key, run] of runs) {
    if (run.cwd !== cwd || run.command !== command) continue;
    if (!run.exited) return { key, run };
    ended ??= { key, run };
  }
  return ended;
}

// A thread's own run (keyed by its card id, not `folder:<cwd>`): the card, so the row can open it.
function owner(key: string, cards: readonly Card[]): { cardId: string; title?: string } | undefined {
  const card = key.startsWith("folder:") ? undefined : cards.find((c) => c.id === key);
  return card && { cardId: card.id, ...(card.title && { title: card.title }) };
}

async function withRun(cwd: string, c: LauncherCommand, cards: readonly Card[]): Promise<LauncherCommand> {
  const found = runFor(cwd, c.command);
  if (!found) return c.url && (await reachable(c.url)) ? { ...c, answering: true } : c;
  const url = found.run.url ?? c.url;
  const status = await devStatus(found.key, url);
  // With no url to probe, a live run reads as running until it exits (as in lib/devserver-list.ts).
  const state: ServiceState = status.state === "starting" && !url ? "running" : status.state;
  return { ...c, run: { id: `dev:${found.key}`, state, startedAt: found.run.startedAt, restarts: found.run.restarts ?? 0, ...owner(found.key, cards) } };
}

// Weft's own folder, when a card works in it: listed (it's a repo with dev servers too) but marked
// self, since its dev server is this board and a second `next dev` would take its port. Its url is
// the port this server listens on, else what its dev script names.
function selfLauncher(cards: readonly Card[], self = process.cwd(), port = process.env.PORT): DevLauncher[] {
  const own = path.resolve(/*turbopackIgnore: true*/ self);
  if (!cards.some((c) => !c.archived && c.cwd && path.resolve(c.cwd) === own)) return [];
  const commands = detectDevCommands(own);
  const url = port ? `http://127.0.0.1:${port}` : commands[0]?.url;
  return commands.length ? [{ cwd: own, commands, self: true, ...(url && { url }) }] : [];
}

// Every working folder that has a way to start, with each command's run; probed together. Weft's own last.
export async function listLaunchers(cards: readonly Card[] = listCards()): Promise<DevLauncher[]> {
  const found = workingFolders(cards)
    .map((cwd) => ({ cwd, commands: detectDevCommands(cwd) }))
    .filter((l) => l.commands.length);
  const probed = await Promise.all(found.map(async (l) => ({ cwd: l.cwd, commands: await Promise.all(l.commands.map((c) => withRun(l.cwd, c, cards))) })));
  return [...probed, ...selfLauncher(cards)];
}

export class LaunchRefused extends Error {}

// Start a folder's dev server, or restart the one already running it (whichever card started it).
// Only a command the folder's own files name, in a working folder, ever runs from here.
export async function launch(cwd: string, command: string, cards: readonly Card[] = listCards()): Promise<{ result: "started" | "restarted"; id: string }> {
  const folder = path.resolve(cwd);
  if (!workingFolders(cards).includes(folder)) throw new LaunchRefused("That folder isn't one of the board's.");
  const found = detectDevCommands(folder).find((c) => c.command === command);
  if (!found) throw new LaunchRefused(`${command} isn't a dev command in ${path.basename(folder)}.`);
  const current = runFor(folder, command);
  if (current && !current.run.exited) {
    await restartDev(current.key);
    return { result: "restarted", id: `dev:${current.key}` };
  }
  const key = current?.key ?? folderKey(folder);
  await startDev(key, command, folder, undefined, found.url);
  return { result: "started", id: `dev:${key}` };
}
