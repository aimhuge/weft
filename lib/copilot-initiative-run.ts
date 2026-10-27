import { execFile } from "node:child_process";
import fs from "node:fs";
import { basename, join } from "node:path";
import { subscribe } from "./bus";
import {
  blocked,
  counted,
  EMPTY_STATE,
  landedText,
  markLanded,
  morningDue,
  morningText,
  settledMove,
  shownText,
  today,
  worthALook,
  type CheckInKind,
  type InitiativeState,
} from "./copilot-initiative";
import { isQuiet } from "./copilot-lane";
import { activeProjects } from "./copilot-sources";
import { firstLine } from "./format";
import { readScout } from "./scout";
import { DATA_DIR, dropThreadFrom, getThread, listCards } from "./store";
import { COPILOT_ID, type Card, type ThreadItem } from "./types";

// The copilot's check-ins (lib/copilot-initiative.ts) on a clock: every TICK_MS it reads each busy project's HEAD,
// and when the rules allow, sends the copilot a morning or a landed-work check-in. A check-in it answers QUIET is
// taken back out of the thread, so the chat only ever shows the ones with something to say.

const FILE = join(DATA_DIR, "copilot-initiative.json");
const TICK_MS = 5 * 60_000;
// How long a check-in's QUIET is watched for before it's left alone.
const QUIET_WATCH_MS = 15 * 60_000;

export function readState(file = FILE): InitiativeState {
  try {
    return { ...EMPTY_STATE, ...(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<InitiativeState>) };
  } catch {
    return EMPTY_STATE;
  }
}

export const writeState = (s: InitiativeState, file = FILE) => fs.writeFileSync(file, JSON.stringify(s));

// The copilot menu's "Checks in on its own"; on unless you turn it off.
export const checkInsOn = (file = FILE) => !readState(file).off;
export const setCheckInsOn = (on: boolean, file = FILE) => writeState({ ...readState(file), off: on ? undefined : true }, file);

export const git = (cwd: string, args: string[]) =>
  new Promise<string>((resolve) => execFile("git", args, { cwd, timeout: 5_000 }, (err, out) => resolve(err ? "" : out.trim())));

type Send = (text: string, opts: { cli: string }) => void;

export type Deps = {
  now?: () => Date;
  cards?: () => Card[];
  busy?: () => boolean;
  send?: Send;
  git?: typeof git;
  file?: string;
};

// The open refactor scout findings for a project, one line each.
function scoutLines(root: string): string[] {
  const scout = readScout(root);
  if (!scout) return [];
  return scout.findings
    .filter((f) => !scout.started.includes(f.id))
    .slice(0, 3)
    .map((f) => `- ${basename(f.file)}${f.line ? `:${String(f.line)}` : ""} ${f.smell}: ${firstLine(f.fix, 100)}`);
}

// One look at the clock. Returns the kind of check-in sent, if any.
export async function tick(deps: Deps = {}): Promise<CheckInKind | null> {
  const { now = () => new Date(), cards = listCards, busy = () => false, git: run = git, file = FILE } = deps;
  const at = now();
  const list = cards();
  const roots = activeProjects(list);
  const heads = Object.fromEntries((await Promise.all(roots.map(async (r) => [r, await run(r, ["rev-parse", "HEAD"])] as const))).filter(([, h]) => h));
  const move = settledMove(today(readState(file), at), heads, at.getTime());
  let s = move.state;
  let sent: CheckInKind | null = null;
  const send = (kind: CheckInKind, cli: string, root?: string) => {
    (deps.send ?? sendCheckIn)(shownText(kind, root), { cli });
    s = counted(s, at, kind);
    sent = kind;
  };
  if (!blocked(s, at, { busy: busy(), items: getThread(COPILOT_ID) })) {
    const lastActivity = Math.max(0, ...list.filter((c) => c.role !== "copilot").map((c) => c.lastActivity ?? c.updatedAt));
    if (morningDue(s, at, lastActivity)) send("morning", morningText(roots.map((r) => basename(r))));
    else if (move.landed) {
      const { root, from, head } = move.landed;
      const log = await run(root, ["log", "--format=%s", "-n", "15", `${from}..${head}`]);
      const commits = worthALook(log.split("\n").filter(Boolean)).map((c) => `- ${c}`);
      s = markLanded(s, root, head);
      if (commits.length) send("landed", landedText(root, commits, scoutLines(root)), root);
    }
  }
  writeState(s, file);
  return sent;
}

// Sends a check-in to the copilot, and takes it back out of the thread if the answer is QUIET.
function sendCheckIn(text: string, opts: { cli: string }) {
  const from = getThread(COPILOT_ID).length;
  // Loaded here, not at the top: the runner pulls in the whole CLI stack, and the rules above are tested without it.
  void import("./runner").then(({ sendUserMessage }) => {
    sendUserMessage(COPILOT_ID, text, opts);
    watchForQuiet(from);
  });
}

// When the check-in's turn ends with QUIET (and you haven't written since), drop the check-in and its answer.
export function watchForQuiet(from: number, wait = QUIET_WATCH_MS) {
  const stop = () => {
    clearTimeout(timer);
    unsubscribe();
  };
  const timer = setTimeout(stop, wait);
  const unsubscribe = subscribe((event) => {
    if (event.type !== "card" || event.card.id !== COPILOT_ID || event.card.column === "running") return;
    const after = getThread(COPILOT_ID).slice(from);
    const users = after.filter((i) => i.kind === "user");
    const reply = after.filter((i): i is Extract<ThreadItem, { kind: "assistant" }> => i.kind === "assistant").at(-1);
    if (users.length > 1) {
      stop();
      return;
    }
    if (!reply) return;
    if (isQuiet(reply.text)) dropThreadFrom(COPILOT_ID, from);
    stop();
  });
}

const g = globalThis as unknown as { __weftCheckIns?: ReturnType<typeof setInterval> };

// Once per server (from prewarm in lib/copilot.ts).
export function startCheckIns(busy: () => boolean, file = FILE) {
  if (g.__weftCheckIns) return;
  g.__weftCheckIns = setInterval(() => {
    if (!checkInsOn(file)) return;
    tick({ busy, file }).catch((err: unknown) => console.error("[weft] copilot check-in failed:", err));
  }, TICK_MS);
  g.__weftCheckIns.unref();
}
