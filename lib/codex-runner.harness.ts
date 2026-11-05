// The fake `codex exec` child and module mocks the codex-runner turn-loop tests share
// (lib/codex-runner-events.test.ts, lib/codex-runner-turn.test.ts). Mirrors lib/runner.harness.ts:
// a test file makes the shared state with vi.hoisted and hands it to the mock factories below, then
// installs the beforeEach/afterEach through setupCodex().
//
// `codex exec` is a real child process in production, so node:child_process's spawn is mocked here
// rather than spawnCli: lib/cli-process.ts, lib/codex-runner.ts's drive loop, readEvents, handleEvent,
// toolStart/toolFinish, noteFileChanges, result and assertTurnCompleted all run for real against the
// fake child's stdout. The one thing faked is lib/runner-turn.ts's handle(), which appends to the card's
// thread and records each tool call's index — this mock does that same bookkeeping and logs the message.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { Inbox } from "./runner-state";
import type { Card, ThreadItem } from "./types";

export type Handled = { cardId: string; msg: Record<string, unknown> };
export type SpawnOptions = { command: string; args: string[]; cwd: string; env: Record<string, string>; signal: AbortSignal };

export function codexState() {
  return {
    // Every message handle() was given, in order.
    handled: [] as Handled[],
    // The fake child each spawn() returned; the newest is the one driveCodex is reading.
    spawned: [] as FakeChild[],
    // What spawn() throws outright, and what fails the child with an "error" event instead.
    throwOn: null as null | string,
    errorEvent: null as null | string,
    cards: new Map<string, Card>(),
    threads: new Map<string, ThreadItem[]>(),
  };
}

export type State = ReturnType<typeof codexState>;

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
  /** The JSON lines a real `codex exec --json` writes, then the exit it closes with. */
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
 *  own top-level vi.mock (which is hoisted above its imports), exactly as lib/runner.harness.ts does. */
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

export const weftMcpMock = () => ({ weftMcpServers: () => ({ browser: { instance: {} }, board: { instance: {} } }) });

export const childProcessMock = (s: State) => ({
  // lib/env.ts reaches lib/changelog-write.ts, which promisifies execFile on load; never called here.
  execFile: () => undefined,
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    if (s.throwOn) throw new Error(s.throwOn);
    const child = new FakeChild();
    child.options = { command, args, cwd: options.cwd as string, env: options.env as Record<string, string>, signal: options.signal as AbortSignal };
    s.spawned.push(child);
    return child;
  },
  default: { spawn: () => new FakeChild() },
  execFileSync: () => "",
});

export const settingsMock = async (importOriginal: () => Promise<typeof import("./settings")>) => ({
  ...(await importOriginal()),
  subagentModel: () => undefined,
  threadPrompt: () => "THREAD PROMPT",
});

// Weft's guards for the turn (lib/guards/turn.ts), which need the server's port; their own tests are lib/guards/*.
// The fake turn's env names its token, so a test can see the guards opened and reached the CLI.
export const guardsTurnMock = async (importOriginal: () => Promise<typeof import("./guards/turn")>) => ({
  ...(await importOriginal()),
  openGuards: vi.fn(() => ({ token: "guard-token", url: "http://127.0.0.1:0/api/guards", env: { WEFT_GUARD_TOKEN: "guard-token" }, close: vi.fn() })),
});

export const EXE = "/opt/bin/codex";

/** The per-test session under drive, and the fake child the newest spawn() returned. */
export type Rig = {
  state: State;
  codex: typeof import("./codex-runner");
  session: import("./runner-state").Session;
  cwd: string;
  /** Pushes one user message, runs the spawned child with these lines/exit and returns the pending promise. */
  start: (lines?: string[], exit?: { code: number | null; signal?: NodeJS.Signals | null }) => Promise<unknown>;
  /** Closes the inbox so the drive loop returns (a real session stays open), then gives back the promise. */
  finish: (promise: Promise<unknown>) => Promise<unknown>;
  /** run() with a turn.completed appended when the caller left the turn's ending off. */
  run: (lines: string[], exit?: { code: number | null; signal?: NodeJS.Signals | null }) => Promise<unknown>;
  /** Queues a raw user message, bypassing Inbox.push's text-to-block building (an image arrives split). */
  pushRaw: (message: unknown) => void;
  child: () => FakeChild;
  opts: () => SpawnOptions;
};

/** Builds the rig and the beforeEach/afterEach that give each test a fresh module graph and session.
 *  The test file owns the vi.mock lines (they hoist above its imports); setupCodex only reads the state.
 *
 *  No vi.resetModules() here: a test file's hoisted mock factories reach this harness through
 *  `await import("./codex-runner.harness")`, and resetting the registry inside the hook re-enters the
 *  module runner from inside a factory that is itself being resolved — the runner deadlocks and the
 *  hook's own `import("./codex-runner")` never settles ("Hook timed out"). The module graph is fixed
 *  for the file anyway; each test gets its freshness from the cleared state and a new session. */
export function setupCodex(s: State) {
  let rig: Rig;
  beforeEach(async () => {
    vi.restoreAllMocks();
    s.handled.length = 0;
    s.spawned.length = 0;
    s.throwOn = null;
    s.errorEvent = null;
    s.cards.clear();
    s.threads.clear();
    const cwd = await import("node:fs").then((fs) => fs.realpathSync(fs.mkdtempSync("/tmp/weft-codex-")));
    vi.stubEnv("PORT", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const codex = await import("./codex-runner");
    const session = makeSession(cwd);
    const lastChild = () => {
      const child = s.spawned.at(-1);
      if (!child) throw new Error("codex exec was never spawned");
      return child;
    };
    const start = async (lines: string[] = [], exit?: { code: number | null; signal?: NodeJS.Signals | null }) => {
      const promise = codex.driveCodex(session, EXE);
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
      const ended = exit || lines.some((l) => l.includes('"turn.completed"') || l.includes('"turn.failed"'));
      return finish(start(ended ? lines : [...lines, JSON.stringify({ type: "turn.completed" })], exit));
    };
    rig = {
      state: s,
      codex,
      session,
      cwd,
      start,
      finish,
      run,
      pushRaw: (message: unknown) => {
        (session.inbox as unknown as { queue: unknown[] }).queue.push(message);
        (session.inbox as unknown as { wake?: () => void }).wake?.();
      },
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
    spec: { cwd, backend: "codex", permissionMode: "default", copilot: false },
    inbox: new Inbox(),
    abort: new AbortController(),
    busy: false,
    stopping: false,
    pending: [],
    toolIndex: new Map<string, number>(),
    done: Promise.resolve(),
  } as unknown as import("./runner-state").Session;
}