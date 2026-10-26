// The fake SDK and module mocks the runner's tests share (lib/runner.test.ts, lib/runner-edit.test.ts).
// A test file makes the shared state with vi.hoisted (harnessState) and hands it to the mock factories:
//   vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as ChildProcess from "node:child_process";
import { vi } from "vitest";
import type { SubagentModel } from "./subagents";
import type { Card, ThreadItem } from "./types";

// lib/runner-session.ts now calls lib/skill-sets.ts (ensureSeeded, offFor) on every spare.
// ensureSeeded reads ~/.weft/skill-sets.json and may write one, so we redirect DATA_DIR to a temp
// dir here — every runner test imports this harness before any module that captures the env var.
if (!process.env.WEFT_DATA) {
  const _weftDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-runner-data-"));
  process.env.WEFT_DATA = _weftDataDir;
}

// Captured before any test fakes timers, so flush() always really waits.
const realSetTimeout = globalThis.setTimeout;

export type Options = Record<string, unknown> & {
  abortController: AbortController;
  canUseTool: (toolName: string, input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

// A scripted stand-in for the SDK's Query: tests push SDK messages with emit(), and it records the user
// messages runner feeds into its prompt.
export class FakeQuery {
  options: Options;
  received: string[] = [];
  // The uuid each user message was sent with (the prompt id ↑ rewinds by).
  uuids: (string | undefined)[] = [];
  inputClosed = false;
  interrupt = vi.fn(async () => {});
  setPermissionMode = vi.fn(async () => {});
  setModel = vi.fn(async () => {});
  applyFlagSettings = vi.fn(async () => {});
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = vi.fn((): Promise<unknown> => Promise.resolve({}));
  private queue: unknown[] = [];
  private wake?: () => void;
  private done = false;
  private error?: Error;

  constructor({ prompt, options }: { prompt: AsyncIterable<{ message: { content: unknown }; uuid?: string }>; options: Options }) {
    this.options = options;
    // The real SDK throws once its abort controller fires.
    options.abortController.signal.addEventListener("abort", () => this.fail(new Error("Claude Code process aborted by user")));
    void (async () => {
      for await (const m of prompt) {
        const c = m.message.content;
        this.received.push(typeof c === "string" ? c : JSON.stringify(c));
        this.uuids.push(m.uuid);
      }
      this.inputClosed = true;
    })();
  }

  get aborted() {
    return this.options.abortController.signal.aborted;
  }

  emit(...msgs: unknown[]) {
    this.queue.push(...msgs);
    this.wake?.();
  }

  end() {
    this.done = true;
    this.wake?.();
  }

  fail(err: Error) {
    this.error = err;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      while (this.queue.length) yield this.queue.shift();
      if (this.error) throw this.error;
      if (this.done) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}

export function harnessState() {
  return {
    cards: new Map<string, Card>(),
    threads: new Map<string, ThreadItem[]>(),
    queries: [] as FakeQuery[],
    keepAlive: 0,
    // The cap on threads running at once (lib/thread-slots.ts); 0 is no limit.
    maxThreads: 0,
    subagentModel: "choose" as SubagentModel,
    openElsewhere: false,
    // sessionId → transcript file, as lib/import.ts finds them.
    sessionFiles: new Map<string, string>(),
    startLogin: [] as { backend: string; onDone?: () => void }[],
    cancelLogin: [] as string[],
    noteTrial: [] as { backend: string; trial: unknown }[],
    // Weft's Puku trial (lib/puku-trial.ts), as the tests set it.
    ownPukuLogin: false,
    trialJustFetched: false,
    trialResult: { ok: true } as { ok: true } | { ok: false; reason: string; message: string },
    fetchedTrials: 0,
    trialOptions: null as null | { env: Record<string, string>; settings: { apiKeyHelper: string } },
    // Per-card off-list override for the skill-sets mock: when set, offFor returns it for that card's cwd.
    skillOffByCwd: new Map<string, string[]>(),
    // Calls to ensureSeeded in the skill-sets mock.
    skillSeededCwds: [] as string[],
    skillsForPrompt: [] as string[],
    publish: [] as unknown[],
    execCalls: [] as string[][],
    // Make the faked which / git / startLogin throw.
    execFails: false,
    loginFails: false,
  };
}

export type Harness = ReturnType<typeof harnessState>;

export const sdkMock = (h: Harness) => ({
  query: (args: ConstructorParameters<typeof FakeQuery>[0]) => {
    const q = new FakeQuery(args);
    h.queries.push(q);
    return q;
  },
  tool: (name: string) => ({ name }),
  createSdkMcpServer: (opts: { name: string }) => ({ type: "sdk", name: opts.name }),
});

// A card's thread in the fake store, made empty the first time it's asked for.
function threadOf(h: Harness, id: string) {
  const items = h.threads.get(id) ?? [];
  h.threads.set(id, items);
  return items;
}

export const storeMock = (h: Harness) => ({
  DATA_DIR: "/nonexistent-weft-test-data",
  getCard: (id: string) => h.cards.get(id),
  listCards: () => [...h.cards.values()],
  createCard: () => {
    throw new Error("not used");
  },
  updateCard: (id: string, patch: Partial<Card>) => {
    const card = h.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    return Object.assign(card, patch);
  },
  getThread: (id: string) => threadOf(h, id),
  appendThread: (id: string, item: ThreadItem) => threadOf(h, id).push(item) - 1,
  replaceThreadItem: (id: string, index: number, item: ThreadItem) => {
    threadOf(h, id)[index] = item;
  },
  foldThread: (id: string, from: number) => {
    const items = threadOf(h, id);
    items.splice(from, items.length - from, { kind: "edited", items: items.slice(from), at: 0 });
  },
});

export const busMock = (h: Harness) => ({ publish: (e: unknown) => h.publish.push(e) });
// Hands back the restart guard's count of other running turns as options.otherTurns, for tests to call.
export const envMock = (restartPrompt = "RESTART PROMPT") => ({
  RESTART_PROMPT: restartPrompt,
  guardedCli: (otherTurns: () => number) => ({ env: { PATH: "/usr/bin" }, hooks: { PreToolUse: [] }, otherTurns }),
});
// A dev reload after RESTART_PROMPT's text changed: the source of every runner function stays the same.
export async function reloadWithEditedPrompt<T>(module: string): Promise<T> {
  vi.resetModules();
  vi.doMock("./env", () => envMock("RESTART PROMPT, edited"));
  try {
    return (await import(/* @vite-ignore */ module)) as T;
  } finally {
    vi.doMock("./env", () => envMock());
  }
}
export const importMock = (h: Harness) => ({ isOpenElsewhere: () => h.openElsewhere, sessionFiles: () => h.sessionFiles });

export const settingsMock = (h: Harness) => ({
  keepAliveMinutes: () => h.keepAlive,
  maxThreads: () => h.maxThreads,
  allowedFolders: () => [] as string[],
  threadPrompt: () => "THREAD PROMPT",
  DEFAULT_THREAD_PROMPT: "DEFAULT THREAD PROMPT",
  subagentModel: () => h.subagentModel,
  defaultPermissionMode: () => "bypassPermissions",
  touchProject: () => {},
  automations: () => [],
});

export const loginMock = (h: Harness) => ({
  isNotLoggedInError: (text: string) => /not logged in|please run \/login|invalid api key/i.test(text),
  isRateLimitError: (text: string) => /rate.?limit|hit your limit|usage limit/i.test(text),
  startLogin: (backend: string, onDone?: () => void) => {
    if (h.loginFails) throw new Error("claude isn't on this app's PATH.");
    h.startLogin.push({ backend, onDone });
    return {};
  },
  cancelLogin: (backend: string) => void h.cancelLogin.push(backend),
  noteTrial: (backend: string, trial: unknown) => void h.noteTrial.push({ backend, trial }),
});

export const pukuTrialMock = (h: Harness) => ({
  hasOwnPukuLogin: () => h.ownPukuLogin,
  trialJustFetched: () => h.trialJustFetched,
  fetchTrialToken: () => {
    h.fetchedTrials++;
    return Promise.resolve(h.trialResult);
  },
  trialOptions: () => h.trialOptions,
});

// A pure in-memory replacement for lib/skill-sets.ts so runner tests can pin what offFor returns
// per cwd without touching the file system. ensureSeeded records every cwd it sees; offFor returns
// the per-cwd project's off-list plus the card's own (as the real module would, sorted and
// de-duplicated); withSkillSettings behaves the same as the real module for those off-lists.
export const skillSetsMock = (h: Harness) => ({
  ensureSeeded: (cwd: string) => {
    h.skillSeededCwds.push(cwd);
  },
  offFor: ({ cwd, skillsOff, skillsOn }: { cwd: string; skillsOff?: string[]; skillsOn?: string[] }) => {
    const project = h.skillOffByCwd.get(cwd) ?? [];
    const on = new Set(skillsOn ?? []);
    return [...new Set([...project, ...(skillsOff ?? [])])].filter((n) => !on.has(n)).sort();
  },
  sameOff: (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((n, i) => n === b[i]),
  withSkillSettings: <T extends object>(settings: T | undefined, off: string[] | undefined) => {
    if (!off || !off.length) return settings;
    const skills = off.filter((n) => !n.includes("@"));
    const plugins = off.filter((n) => n.includes("@"));
    return {
      ...(settings as T),
      ...(skills.length ? { skillOverrides: Object.fromEntries(skills.map((n) => [n, "user-invocable-only" as const])) } : {}),
      ...(plugins.length ? { enabledPlugins: Object.fromEntries(plugins.map((id) => [id, false as const])) } : {}),
    };
  },
});

export function childProcessMock(h: Harness, actual: typeof ChildProcess) {
  const execFileSync = (cmd: string, args: string[]) => {
    h.execCalls.push([cmd, ...args]);
    if (h.execFails) throw new Error("exec failed");
    if (cmd === "/usr/bin/which") return "/opt/bin/puku-cli\n";
    if (args.includes("rev-parse")) return "main\n";
    if (args.includes("--numstat")) return "3\t1\ta.ts\n2\t0\tb.ts\n";
    return "";
  };
  return { ...actual, default: { ...actual, execFileSync }, execFileSync };
}

const GLOBALS = ["__weftSessions", "__weftSpares", "__weftLoginWaiters", "__weftQueued", "__weftArchiveAfter"];

// Empties the shared state and the runner's global maps; returns a fresh project folder for the test.
export function resetHarness(h: Harness) {
  h.cards.clear();
  h.threads.clear();
  h.queries.length = 0;
  h.keepAlive = 0;
  h.subagentModel = "choose";
  h.openElsewhere = false;
  h.sessionFiles.clear();
  h.startLogin.length = 0;
  h.cancelLogin.length = 0;
  h.noteTrial.length = 0;
  h.ownPukuLogin = false;
  h.trialJustFetched = false;
  h.trialResult = { ok: true };
  h.fetchedTrials = 0;
  h.trialOptions = null;
  h.skillOffByCwd.clear();
  h.skillSeededCwds.length = 0;
  h.skillsForPrompt = [];
  h.publish.length = 0;
  h.execCalls.length = 0;
  h.execFails = false;
  h.loginFails = false;
  for (const key of GLOBALS) Reflect.deleteProperty(globalThis, key);
  return fs.mkdtempSync(path.join(os.tmpdir(), "weft-runner-"));
}

export async function flush(times = 3) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => realSetTimeout(resolve, 2));
}

export function makeCard(h: Harness, cwd: string, over: Partial<Card> = {}): Card {
  const id = over.id ?? `card-${h.cards.size + 1}`;
  const card: Card = {
    id,
    title: "A card",
    prompt: "do it",
    cwd,
    backend: "claude",
    permissionMode: "default",
    column: "todo" as Card["column"],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
  h.cards.set(id, card);
  return card;
}

// The item at index i (negative counts from the end); throws a clear error when it doesn't exist.
export function nth<T>(arr: readonly T[], i: number, what = "item"): T {
  const item = arr.at(i);
  if (item === undefined) throw new Error(`No ${what} at index ${String(i)} (have ${String(arr.length)})`);
  return item;
}

// SDK messages, with only the fields runner reads.
export const init = (sessionId = "sess-1") => ({ type: "system", subtype: "init", session_id: sessionId });
export const assistant = (...content: unknown[]) => ({ type: "assistant", parent_tool_use_id: null, message: { content } });
export const text = (t: string) => ({ type: "text", text: t });
export const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
export const toolResultMsg = (id: string, content: string, isError = false) => ({
  type: "user",
  parent_tool_use_id: null,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});
export const success = (result: string, over: Record<string, unknown> = {}) => ({
  type: "result",
  subtype: "success",
  result,
  is_error: false,
  total_cost_usd: 0.25,
  session_id: "sess-1",
  modelUsage: {},
  ...over,
});
export const failure = (subtype: string, over: Record<string, unknown> = {}) => ({
  type: "result",
  subtype,
  is_error: true,
  total_cost_usd: 0.1,
  session_id: "sess-1",
  modelUsage: {},
  ...over,
});
