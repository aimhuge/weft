// @vitest-environment node
// The parts of lib/runner-session.ts the other runner tests don't reach: the codex and goose drives
// with no CLI on the PATH, the CLI's own spawn and its stderr, a granted retry, a spare with no
// conversation of its own, and a CLI that fails with something that isn't an Error.
//
// The same harness as lib/runner.test.ts, so the cards, queries and mocks work the same way.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness } from "./runner.harness";
import type { Card } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
// The env's guardedCli asks for the card's id, so the hook that guards a card's writes knows
// which card it is for. The fake calls it, like the real one does.
vi.mock("./env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./env")>()),
  RESTART_PROMPT: "RESTART PROMPT",
  guardedCli: (otherTurns: () => number, cardId: () => string | undefined) => ({
    env: { PATH: "/usr/bin" },
    hooks: { PreToolUse: [] },
    otherTurns,
    // The real one asks for the card's id as it builds its hooks, so it knows whose card it guards.
    cardId: cardId(),
  }),
}));
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: () => h.skillsForPrompt,
}));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

// The CLIs the codex and goose threads drive themselves. The path each one runs on, and a drive
// that holds on until the session ends.
const paths = vi.hoisted((): { codex: string | undefined; goose: string | undefined } => ({ codex: "/opt/codex", goose: "/opt/goose" }));
vi.mock("./cli-path", () => ({
  executableFor: (backend: string) => (backend === "codex" ? paths.codex : backend === "goose" ? paths.goose : undefined),
}));
const drives = vi.hoisted(() => ({ codex: 0, goose: 0 }));
vi.mock("./codex-runner", () => ({
  CODEX_CODE: [],
  driveCodex: (session: { abort: AbortController }) =>
    new Promise<void>((resolve) => {
      drives.codex++;
      session.abort.signal.addEventListener("abort", () => resolve());
    }),
}));
vi.mock("./goose-runner", () => ({
  GOOSE_RUNNER_CODE: [],
  driveGoose: (session: { abort: AbortController }) =>
    new Promise<void>((resolve) => {
      drives.goose++;
      session.abort.signal.addEventListener("abort", () => resolve());
    }),
}));

// The CLI's own spawn: it takes the stderr hook, and the fake calls it so the thread's own
// logger is exercised.
const spawn = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("./cli-process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cli-process")>()),
  spawnCli: (opts: unknown, onStderr?: (text: string) => void) => {
    spawn.calls.push(opts);
    onStderr?.("the CLI wrote this");
    return { pid: 4242, stderrTail: () => "" };
  },
}));
// The plan-limit notice a rate-limited CLI gets.
const limits = vi.hoisted(() => ({ hits: [] as Array<[string, string, string]> }));
vi.mock("./rate-limit", () => ({
  hitRateLimit: (cardId: string, backend: string, message: string) => void limits.hits.push([cardId, backend, message]),
}));

type Runner = typeof import("./runner");
type SessionModule = typeof import("./runner-session");
let runner: Runner;
let session: SessionModule;
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const lastQuery = () => nth(h.queries, -1, "query");

beforeEach(async () => {
  cwd = resetHarness(h);
  paths.codex = "/opt/codex";
  paths.goose = "/opt/goose";
  drives.codex = 0;
  drives.goose = 0;
  spawn.calls.length = 0;
  limits.hits.length = 0;
  vi.resetModules();
  runner = await import("./runner");
  session = await import("./runner-session");
});

afterEach(async () => {
  vi.useRealTimers();
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("the CLI a codex or goose thread drives", () => {
  it("says so when codex isn't on the PATH", async () => {
    paths.codex = undefined;
    addCard({ id: "c1", backend: "codex" });
    runner.sendMessage("c1", "go");
    await flush();
    expect(drives.codex).toBe(0);
    expect(card("c1").error).toContain("Codex CLI isn't on this app's PATH.");
  });

  it("says so when goose isn't on the PATH", async () => {
    paths.goose = undefined;
    addCard({ id: "c1", backend: "goose" });
    runner.sendMessage("c1", "go");
    await flush();
    expect(drives.goose).toBe(0);
    expect(card("c1").error).toContain("goose isn't on this app's PATH.");
  });

  it("drives a goose thread with the CLI on the PATH", async () => {
    addCard({ id: "c1", backend: "goose" });
    runner.sendMessage("c1", "go");
    await flush();
    expect(drives.goose).toBe(1);
    // The drive holds the turn until the CLI ends; stopping the thread ends it, once the
    // grace period the stop gives the CLI has passed.
    await runner.stop("c1");
    const state = await import("./runner-state");
    await vi.waitFor(() => expect(state.sessions.has("c1")).toBe(false), { timeout: 5000 });
  });
});

describe("a spare CLI", () => {
  it("is not kept for codex or goose, which start a process for every turn", async () => {
    session.ensureSpare(cwd, "codex");
    session.ensureSpare(cwd, "goose");
    const state = await import("./runner-state");
    expect(state.spares.size).toBe(0);
  });

  it("has no conversation of its own to hand to the card that takes it", async () => {
    const state = await import("./runner-state");
    // A Codex CLI keeps no conversation of its own: it resumes a saved session of its own instead.
    const spare = session.open({ cwd, backend: "codex", permissionMode: "default", copilot: false }, null);
    state.spares.set(`codex|${cwd}`, spare);
    addCard({ id: "c1", backend: "codex" });
    const taken = session.adoptSpare(card("c1"));
    expect(taken).toBe(spare);
    // The card takes the spare over without a conversation id of its own.
    expect(card("c1").sessionId).toBeUndefined();
    expect(card("c1").warm).toBe(true);
  });
});

describe("the CLI's own spawn", () => {
  it("keeps the process it started, and logs what it wrote to stderr", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    addCard({ id: "c1" });
    runner.sendMessage("c1", "go");
    await flush();
    const opts = lastQuery().options as unknown as { spawnClaudeCodeProcess?: (o: unknown) => { pid?: number } };
    const proc = opts.spawnClaudeCodeProcess!({ command: "claude", args: [], cwd });
    expect(proc.pid).toBe(4242);
    expect(spawn.calls).toHaveLength(1);
    const state = await import("./runner-state");
    expect(state.sessions.get("c1")?.process?.pid).toBe(4242);
    expect(errors.join("\n")).toContain("[thread c1] the CLI wrote this");
    spy.mockRestore();
  });

  it("labels a spare's stderr without a card", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    session.ensureSpare(cwd);
    await flush();
    const state = await import("./runner-state");
    const spare = [...state.spares.values()][0]!;
    // The fake SDK keeps the options it was started with (lib/runner.harness.ts); the real Query type has no such field.
    const opts = (spare.query as unknown as { options: { spawnClaudeCodeProcess?: (o: unknown) => { pid?: number } } }).options;
    opts.spawnClaudeCodeProcess!({ command: "claude", args: [], cwd });
    expect(errors.join("\n")).toContain("[thread spare] the CLI wrote this");
    spy.mockRestore();
  });
});

describe("a call auto mode blocked that the user allowed once", () => {
  it("goes through the next time the CLI asks for it", async () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "go");
    await flush();
    const state = await import("./runner-state");
    const s = state.sessions.get("c1")!;
    s.retryGrants = ['Bash\n{"command":"ls"}'];
    const opts = lastQuery().options as unknown as { canUseTool: (name: string, input: unknown, o: unknown) => Promise<unknown> };
    const result = await opts.canUseTool("Bash", { command: "ls" }, { toolUseID: "t1", title: "Run ls" });
    expect(result).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
  });
});

describe("a CLI that failed", () => {
  it("parks the card when it hit a plan limit", async () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "go");
    await flush();
    lastQuery().fail(new Error("Claude usage limit reached. Try again later."));
    await flush();
    expect(limits.hits).toEqual([["c1", "claude", expect.stringContaining("usage limit")]]);
  });

  it("keeps a failure that isn't an Error as its text", async () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "go");
    await flush();
    lastQuery().fail("just a string" as unknown as Error);
    await flush();
    expect(card("c1").error).toContain("just a string");
  });
});
