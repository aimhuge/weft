// The fake `goose run` child and module mocks the goose-runner tests share (lib/goose-runner.test.ts).
// Mirrors lib/codex-runner.harness.ts: a test file makes the shared state with vi.hoisted and hands it to
// the mock factories below, then installs the beforeEach/afterEach through setupGoose().
//
// `goose run` is a real child process in production, so node:child_process's spawn is mocked here rather
// than spawnCli: lib/cli-process.ts, lib/goose-runner.ts's drive loop, readGooseEvents, handleGooseEvent,
// noteFileChanges, result and saveTurnRecipe all run for real against the fake child's stdout. The one
// thing faked is lib/runner-turn.ts's handle(), which appends to the card's thread and records each tool
// call's index — this mock does that same bookkeeping and logs the message.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { Inbox } from "./runner-state";
import type { Card, ThreadItem } from "./types";

export type Handled = { cardId: string; msg: Record<string, unknown> };
export type SpawnOptions = { command: string; args: string[]; cwd: string; env: Record<string, string>; signal: AbortSignal };

export function gooseState() {
  return {
    // Every message handle() was given, in order.
    handled: [] as Handled[],
    // The fake child each spawn() returned; the newest is the one driveGoose is reading.
    spawned: [] as FakeChild[],
    // What spawn() throws outright, and what fails the child with an "error" event instead.
    throwOn: null as null | string,
    errorEvent: null as null | string,
    cards: new Map<string, Card>(),
    threads: new Map<string, ThreadItem[]>(),
  };
}

export type State = ReturnType<typeof gooseState>;

// Just enough of a spawned child for lib/cli-process.ts's spawnCli: piped stdio, an exit event, a pid.
export class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  pid = 4242;
  options!: SpawnOptions;
  kill() {
    this.killed = true;
    return true;
  }
  /** The JSON lines a real `goose run --output-format stream-json` writes, then the exit it closes with. */
  run(s: State, lines: string[], exit: { code: number | null; signal?: NodeJS.Signals | null } = { code: 0 }) {
    for (const line of lines) this.stdout.write(`${line}\n`);
    this.stdout.end();
    if (s.errorEvent) this.emit("error", new Error(s.errorEvent));
    this.exitCode = exit.code;
    this.emit("exit", exit.code, exit.signal ?? null);
    this.emit("close", exit.code, exit.signal ?? null);
  }
}

/** The vi.mock factories, each closing over the file's hoisted state. A test file calls them inside its
 *  own top-level vi.mock (which is hoisted above its imports), exactly as lib/codex-runner.harness.ts does. */
export const runnerTurnMock = (s: State) => ({
  handle: (cardId: string, session: import("./runner-state").Session, msg: Record<string, unknown>) => {
    s.handled.push({ cardId, msg });
    const content = (msg.message as { content?: { type: string; id?: string }[] } | undefined)?.content ?? [];
    for (const block of content) {
      if (block.type !== "tool_use" || !block.id) continue;
      const items = s.threads.get(cardId) ?? [];
      s.threads.set(cardId, items);
      items.push({ kind: "tool", id: block.id, name: "", summary: "", action: "", at: 0 });
      session.toolIndex.set(block.id, items.length - 1);
    }
    return Promise.resolve();
  },
});

export const storeMock = (s: State) => ({
  DATA_DIR: "/nonexistent-weft-test-data",
  getCard: (id: string) => s.cards.get(id),
  // lib/project-seed-find.ts reads listCards on load.
  listCards: () => [...s.cards.values()],
  updateCard: (id: string, patch: Partial<Card>) => {
    const card = s.cards.get(id) ?? ({ id } as unknown as Card);
    if (!s.cards.has(id)) s.cards.set(id, card);
    return Object.assign(card, patch);
  },
  getThread: (id: string) => {
    const items = s.threads.get(id) ?? [];
    s.threads.set(id, items);
    return items;
  },
  replaceThreadItem: (id: string, index: number, item: ThreadItem) => {
    (s.threads.get(id) as ThreadItem[])[index] = item;
  },
});

export const childProcessMock = (s: State) => ({
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    if (s.throwOn) throw new Error(s.throwOn);
    const child = new FakeChild();
    child.options = { command, args, cwd: options.cwd as string, env: options.env as Record<string, string>, signal: options.signal as AbortSignal };
    s.spawned.push(child);
    return child;
  },
  default: { spawn: () => new FakeChild() },
  execFileSync: () => "",
  // The changelog writer (lib/changelog-write.ts) promisifies execFile at import time, so the mock has to
  // carry it even though no Goose turn calls it.
  execFile: (_command: string, _args: string[], callback?: (err: Error | null, stdout: string) => void) => {
    callback?.(null, "");
    return new FakeChild();
  },
});

export const EXE = "/opt/bin/goose";

/** The per-test session under drive, and the fake child the newest spawn() returned. */
export type Rig = {
  state: State;
  goose: typeof import("./goose-runner");
  session: import("./runner-state").Session;
  cwd: string;
  /** Pushes one user message, runs the spawned child with these lines/exit and returns the pending promise. */
  start: (lines?: string[], exit?: { code: number | null; signal?: NodeJS.Signals | null }) => Promise<unknown>;
  /** Closes the inbox so the drive loop returns (a real session stays open), then gives back the promise. */
  finish: (promise: Promise<unknown>) => Promise<unknown>;
  /** run() with a complete event appended when the caller left the turn's ending off. */
  run: (lines: string[], exit?: { code: number | null; signal?: NodeJS.Signals | null }) => Promise<unknown>;
  child: () => FakeChild;
  opts: () => SpawnOptions;
};

/** Builds the rig and the beforeEach/afterEach that give each test a fresh module graph and session.
 *  The test file owns the vi.mock lines (they hoist above its imports); setupGoose only reads the state. */
export function setupGoose(s: State) {
  let rig: Rig;
  beforeEach(async () => {
    vi.restoreAllMocks();
    s.handled.length = 0;
    s.spawned.length = 0;
    s.throwOn = null;
    s.errorEvent = null;
    s.cards.clear();
    s.threads.clear();
    const cwd = await import("node:fs").then((fs) => fs.realpathSync(fs.mkdtempSync("/tmp/weft-goose-")));
    // Goose's state root (recipes, sessions) goes under WEFT_DATA: a temp one, or the tests write into ~/.weft.
    vi.stubEnv("WEFT_DATA", await import("node:fs").then((fs) => fs.mkdtempSync("/tmp/weft-goose-data-")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const goose = await import("./goose-runner");
    const session = makeSession(cwd);
    const lastChild = () => {
      const child = s.spawned.at(-1);
      if (!child) throw new Error("goose run was never spawned");
      return child;
    };
    const start = async (lines: string[] = [], exit?: { code: number | null; signal?: NodeJS.Signals | null }) => {
      const promise = goose.driveGoose(session, EXE);
      session.inbox.push("do it");
      await vi.waitFor(() => expect(s.spawned.length).toBeGreaterThan(0));
      lastChild().run(s, lines, exit);
      return promise;
    };
    const finish = (promise: Promise<unknown>) => {
      session.inbox.close();
      return promise;
    };
    const run = (lines: string[], exit?: { code: number | null; signal?: NodeJS.Signals | null }) => {
      const ended = exit || lines.some((l) => l.includes('"complete"'));
      return finish(start(ended ? lines : [...lines, JSON.stringify({ type: "complete", text: "Done." })], exit));
    };
    rig = {
      state: s,
      goose,
      session,
      cwd,
      start,
      finish,
      run,
      child: lastChild,
      opts: () => lastChild().options,
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rig.session.inbox.close();
  });

  return () => rig;
}

function makeSession(cwd: string) {
  return {
    build: "b1",
    cardId: "card-1",
    spec: { cwd, backend: "goose", permissionMode: "default", copilot: false },
    inbox: new Inbox(),
    abort: new AbortController(),
    busy: false,
    stopping: false,
    pending: [],
    toolIndex: new Map<string, number>(),
    done: Promise.resolve(),
  } as unknown as import("./runner-state").Session;
}
