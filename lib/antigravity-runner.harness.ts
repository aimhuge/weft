// The fake `agy acp` child and module mocks the antigravity-runner tests share (lib/antigravity-runner-start.test.ts,
// lib/antigravity-runner-turn.test.ts). Mirrors lib/codex-runner.harness.ts: a test file makes the shared state with
// vi.hoisted, hands it to the mock factories below in its own top-level vi.mock lines, and installs the hooks through
// setupAgy().
//
// node:child_process's spawn is mocked, not spawnCli, so lib/cli-process.ts, lib/acp-client.ts and the runner's ACP
// conversation all run for real against a fake agy that answers JSON-RPC on its stdin. The fake has no pid, so
// cli-process never signals a real process group. Faked: lib/runner-turn.ts's handle() (with its tool-row
// bookkeeping), the store, the vault's redaction, the remembered models, and Weft's guards and MCP bridge (each has its
// own tests).
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, vi } from "vitest";
// Type-only: importing runner-state for real would load the mocked store from inside a mock factory, and deadlock.
import type { Session } from "./runner-state";
import type { Card, ThreadItem } from "./types";

export type Rpc = { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
/** What the fake agy does with one request from Weft: answer with a result, an error, or nothing (the test answers). */
export type Reply = { result?: unknown; error?: { code?: number; message?: string }; before?: string[] } | "silent";

export function agyState() {
  return {
    handled: [] as Record<string, unknown>[],
    spawned: [] as FakeAgy[],
    throwOn: null as null | string,
    cards: new Map<string, Card>(),
    threads: new Map<string, ThreadItem[]>(),
    published: [] as unknown[],
    // Replies every fake agy spawned from now on starts with, over its defaults.
    replies: {} as FakeAgy["replies"],
  };
}

export type State = ReturnType<typeof agyState>;

/** A fake `agy acp`: reads Weft's JSON-RPC lines on stdin and answers each request from `replies` by method. */
export class FakeAgy extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  pid = undefined;
  options!: { command: string; args: string[]; cwd: string; env: Record<string, string> };
  // Everything Weft wrote, parsed.
  received: Rpc[] = [];
  replies: Record<string, Reply | ((msg: Rpc) => Reply)> = {
    initialize: { result: { protocolVersion: 1 } },
    "session/new": { result: { sessionId: "S" } },
    "session/set_mode": { result: {} },
    "session/set_model": { result: {} },
    "session/prompt": { result: { stopReason: "end_turn" } },
  };
  /** Whether Weft ended agy's stdin, agy's own way out. */
  get stdinEnded() {
    return this.stdin.writableEnded;
  }
  private buffer = "";

  constructor() {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let at = this.buffer.indexOf("\n"); at >= 0; at = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, at);
        this.buffer = this.buffer.slice(at + 1);
        this.take(JSON.parse(line) as Rpc);
      }
    });
  }

  kill() {
    this.killed = true;
    return true;
  }

  /** Writes lines to Weft as agy would. */
  send(...lines: string[]) {
    for (const line of lines) this.stdout.write(`${line}\n`);
  }

  /** The process going away: its stderr said `why`, then stdout ends and it exits. */
  die(why = "", code = 1) {
    if (why) this.stderr.write(why);
    setTimeout(() => {
      this.stdout.end();
      this.exitCode = code;
      this.emit("exit", code, null);
    }, 5);
  }

  requests(method: string) {
    return this.received.filter((m) => m.method === method && m.id !== undefined);
  }

  private take(msg: Rpc) {
    this.received.push(msg);
    this.emit("received", msg);
    if (msg.id === undefined || !msg.method) return;
    const rule = this.replies[msg.method];
    const reply = typeof rule === "function" ? rule(msg) : rule;
    if (!reply || reply === "silent") return;
    this.send(...(reply.before ?? []), JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...(reply.error ? { error: reply.error } : { result: reply.result }) }));
  }
}

export const runnerTurnMock = (s: State) => ({
  handle: (cardId: string, session: Session, msg: Record<string, unknown>) => {
    s.handled.push(msg);
    for (const block of ((msg.message as { content?: { type: string; id?: string }[] } | undefined)?.content ?? [])) {
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
  // lib/attachments.ts (through runner-state's Inbox) reads it on load.
  DATA_DIR: "/nonexistent-weft-test-data",
  getCard: (id: string) => s.cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => {
    const card = s.cards.get(id) ?? ({ id } as unknown as Card);
    s.cards.set(id, card);
    return Object.assign(card, patch);
  },
  getThread: (id: string) => s.threads.get(id) ?? [],
  replaceThreadItem: (id: string, index: number, item: ThreadItem) => {
    (s.threads.get(id) as ThreadItem[])[index] = item;
  },
});

export const childProcessMock = (s: State) => ({
  execFile: () => undefined,
  execFileSync: () => "",
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    if (s.throwOn) throw new Error(s.throwOn);
    const child = new FakeAgy();
    child.options = { command, args, cwd: options.cwd as string, env: options.env as Record<string, string> };
    Object.assign(child.replies, s.replies);
    s.spawned.push(child);
    return child;
  },
});

export const guardsMock = () => ({
  openAgyGuards: vi.fn(() => ({ env: { WEFT_GUARD_URL: "http://127.0.0.1:7/api/guards" }, bind: vi.fn(), close: vi.fn() })),
});

export const mcpMock = () => ({
  openAgyMcp: vi.fn(() => ({ servers: [{ name: "browser", command: "node", args: ["relay", "url"], env: [] }], close: vi.fn() })),
});

// What this account's models are, remembered for the pickers (lib/antigravity-models.ts has its own tests).
export const modelsMock = () => ({ rememberAgyModels: vi.fn() });

export const promptDepsMocks = {
  weftPrompts: () => ({ weftSystemPrompt: () => "WEFT PROMPT" }),
  pukuContext: () => ({ codexProjectInstructions: () => "" }),
  skills: () => ({ skillIndex: () => "", skillInvocation: (text: string) => text }),
};

export const EXE = "/opt/bin/agy";
export const CWD = "/tmp/p";

export function makeSession(over: Record<string, unknown> = {}): Session {
  return {
    cardId: "card-1",
    spec: { cwd: CWD, backend: "antigravity", permissionMode: "default", copilot: false },
    abort: new AbortController(),
    pending: [],
    toolIndex: new Map<string, number>(),
    ...over,
  } as unknown as Session;
}

/** Resets the shared state before each test and silences the runner's console.error. */
export function setupAgy(s: State) {
  beforeEach(() => {
    s.handled.length = 0;
    s.spawned.length = 0;
    s.throwOn = null;
    s.cards.clear();
    s.threads.clear();
    s.published.length = 0;
    s.replies = {};
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const child of s.spawned) child.stdout.end();
  });
  return {
    child: () => {
      const child = s.spawned.at(-1);
      if (!child) throw new Error("agy acp was never spawned");
      return child;
    },
  };
}
