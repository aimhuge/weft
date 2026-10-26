// @vitest-environment node
// The parts of lib/runner.ts the other runner tests don't reach: the /done override's undo, the queue's
// own edges, stopping a Codex thread, the retry after a login, and the board tools' actions.
// Same harness setup as lib/runner.test.ts, so the cards, queries and mocks work the same way.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness, success } from "./runner.harness";
import type { Card, ThreadItem } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
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

// The pane page a card's message carries, and the starter page a turn shows. The starter page's
// write can fail; the turn carries on when it does.
const pane = vi.hoisted(() => ({ url: undefined as string | undefined }));
vi.mock("./pane-page", () => ({ panePage: () => pane.url }));
const starter = vi.hoisted(() => ({ fails: false }));
vi.mock("./show", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./show")>()),
  showStarter: vi.fn(() => (starter.fails ? Promise.reject(new Error("no starter page")) : Promise.resolve())),
}));

// A Codex or Goose thread drives its own CLI, not the SDK's. The path each one runs on, and a drive
// that waits for the session to end, so the thread stays open.
const paths = vi.hoisted((): { codex: string | undefined; goose: string | undefined } => ({ codex: "/opt/codex", goose: "/opt/goose" }));
vi.mock("./cli-path", () => ({
  executableFor: (backend: string) => (backend === "codex" ? paths.codex : backend === "goose" ? paths.goose : backend === "puku" ? "/opt/puku-cli" : undefined),
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

type Runner = typeof import("./runner");
let runner: Runner;
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
const lastQuery = () => nth(h.queries, -1, "query");

async function send(id: string, msg = "hello") {
  runner.sendMessage(id, msg);
  await flush();
  return lastQuery();
}

beforeEach(async () => {
  cwd = resetHarness(h);
  pane.url = undefined;
  starter.fails = false;
  paths.codex = "/opt/codex";
  paths.goose = "/opt/goose";
  drives.codex = 0;
  drives.goose = 0;
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  vi.useRealTimers();
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("the pane page a message carries", () => {
  it("is on the message when the card has a page open", async () => {
    pane.url = "http://127.0.0.1:7788/pane/c1";
    addCard({ id: "c1" });
    await send("c1", "look at this");
    expect(thread("c1")[0]).toMatchObject({ kind: "user", text: "look at this", page: "http://127.0.0.1:7788/pane/c1" });
  });
});

describe("setModel", () => {
  it("keeps the stats' runsOn with the model, when the card has stats", () => {
    addCard({ id: "c1", stats: { contextUsed: 5 } });
    runner.setModel("c1", "puku-ai-2.8");
    expect(card("c1").stats).toMatchObject({ contextUsed: 5, runsOn: { model: "puku-ai-2.8" } });
  });
});

describe("setPermissionMode", () => {
  it("applies the new mode to the open CLI", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    runner.setPermissionMode("c1", "auto");
    expect(card("c1").permissionMode).toBe("auto");
    expect(q.setPermissionMode).toHaveBeenCalledWith("auto");
  });

  it("leaves a card with no open CLI alone", () => {
    addCard({ id: "c1" });
    runner.setPermissionMode("c1", "auto");
    expect(card("c1").permissionMode).toBe("auto");
  });
});

describe("restoreDoneOverride", () => {
  it("does nothing for a card that isn't there", () => {
    expect(() => runner.restoreDoneOverride("gone")).not.toThrow();
  });

  it("does nothing for a card that wasn't patched", () => {
    addCard({ id: "c1" });
    runner.restoreDoneOverride("c1");
    expect(card("c1").preDoneModel).toBeUndefined();
  });

  it("puts the card's own model, effort and backend back", () => {
    addCard({ id: "c1", preDoneModel: "puku-ai-2.8", preDoneEffort: "high", preDoneBackend: "puku" });
    runner.restoreDoneOverride("c1");
    expect(card("c1")).toMatchObject({ model: "puku-ai-2.8", effort: "high", backend: "puku", preDoneModel: undefined, preDoneEffort: undefined, preDoneBackend: undefined });
  });

  it("puts back only what was patched", () => {
    addCard({ id: "c1", preDoneModel: "puku-ai-2.8" });
    runner.restoreDoneOverride("c1");
    expect(card("c1")).toMatchObject({ model: "puku-ai-2.8", preDoneEffort: undefined, preDoneBackend: undefined });
  });

  it("leaves the model alone when only the effort was patched", () => {
    addCard({ id: "c1", preDoneEffort: "high" });
    runner.restoreDoneOverride("c1");
    expect(card("c1")).toMatchObject({ effort: "high", preDoneModel: undefined, preDoneEffort: undefined });
  });

  it("puts the backend back when only that was patched", () => {
    addCard({ id: "c1", preDoneBackend: "puku" });
    runner.restoreDoneOverride("c1");
    expect(card("c1")).toMatchObject({ backend: "puku", preDoneBackend: undefined });
  });
});

describe("the queue of messages waiting for a turn", () => {
  it("does nothing with an empty queue", () => {
    addCard({ id: "c1" });
    runner.queueMessages("c1", []);
    expect(runner.isBusy("c1")).toBe(false);
  });

  it("sends what was queued, one message per turn", async () => {
    addCard({ id: "c1" });
    runner.queueMessages("c1", ["one", "two"]);
    await flush();
    expect(thread("c1").filter((i) => i.kind === "user").map((i) => (i as { text: string }).text)).toEqual(["one"]);
    lastQuery().emit(success("ok"));
    await flush();
    expect(thread("c1").filter((i) => i.kind === "user").map((i) => (i as { text: string }).text)).toEqual(["one", "two"]);
  });
});

describe("stopping a thread", () => {
  it("does nothing for a card with no open CLI", async () => {
    addCard({ id: "c1" });
    await expect(runner.stop("c1")).resolves.toBeUndefined();
  });

  it("does nothing for a CLI that isn't running a turn", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("ok"));
    await flush();
    await expect(runner.stop("c1")).resolves.toBeUndefined();
    expect(q.options.abortController.signal.aborted).toBe(false);
  });

  it("ends a Codex thread's process at once", async () => {
    addCard({ id: "c1", backend: "codex" });
    runner.sendMessage("c1", "go");
    await flush();
    const session = (await import("./runner-state")).sessions.get("c1")!;
    expect(drives.codex).toBe(1);
    await runner.stop("c1");
    expect(session.abort.signal.aborted).toBe(true);
  });

  it("ends the commands the CLI is running, before the CLI itself", async () => {
    addCard({ id: "c1" });
    await send("c1");
    const session = (await import("./runner-state")).sessions.get("c1")!;
    session.process = { pid: 4242, stderrTail: () => "" } as never;
    const tree = await import("./process-tree");
    const spy = vi.spyOn(tree, "findDescendantGroups").mockReturnValue([111]);
    const groups = vi.spyOn(tree, "signalGroups").mockImplementation(() => {});
    await runner.stop("c1");
    expect(groups).toHaveBeenCalledWith([111], "SIGTERM");
    spy.mockRestore();
    groups.mockRestore();
  });

  it("leaves a CLI that ended on its own alone when the grace period is up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    addCard({ id: "c1" });
    const q = await send("c1");
    // The CLI doesn't answer the interrupt, so the stop waits out the grace period.
    q.interrupt.mockImplementation(() => new Promise(() => {}));
    const stopping = runner.stop("c1");
    await vi.advanceTimersByTimeAsync(10);
    // The turn ends in the meantime: there is nothing left for the grace period to end.
    q.emit(success("ok"));
    await vi.advanceTimersByTimeAsync(1_500);
    await stopping;
    vi.useRealTimers();
    expect(q.options.abortController.signal.aborted).toBe(false);
  });
});

describe("ending a thread's CLI", () => {
  it("does nothing for a card with no open CLI", async () => {
    addCard({ id: "c1" });
    await expect(runner.endSession("c1")).resolves.toBeUndefined();
  });
});

describe("retry", () => {
  it("does nothing while the thread is running", async () => {
    addCard({ id: "c1" });
    await send("c1", "first");
    await runner.retry("c1");
    expect(thread("c1").filter((i) => i.kind === "user")).toHaveLength(1);
  });

  it("runs the last message again, without echoing it", async () => {
    addCard({ id: "c1" });
    await send("c1", "first");
    lastQuery().emit(success("ok"));
    await flush();
    await runner.retry("c1");
    await flush();
    expect(thread("c1").filter((i) => i.kind === "user")).toHaveLength(1);
    expect(runner.isBusy("c1")).toBe(true);
  });

  it("does nothing for a card with no message to repeat", async () => {
    addCard({ id: "c1" });
    await runner.retry("c1");
    expect(runner.isBusy("c1")).toBe(false);
  });
});

describe("the board tools' actions", () => {
  it("start a turn, and answer a question", async () => {
    addCard({ id: "c1" });
    const actions = (await import("./runner-state")).hooks.boardActions;
    actions.start("c1", "go");
    await flush();
    expect(runner.isBusy("c1")).toBe(true);
    expect(actions.isBusy("c1")).toBe(true);
    expect(() => actions.answer("c1", true)).toThrow("Nothing is waiting");
  });
});

describe("a turn that can't change the open CLI", () => {
  it("keeps the new permission mode when the CLI refuses it", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.setPermissionMode.mockRejectedValueOnce(new Error("not supported"));
    runner.setPermissionMode("c1", "auto");
    await flush();
    expect(card("c1").permissionMode).toBe("auto");
    expect(q.setPermissionMode).toHaveBeenCalledWith("auto");
  });

  it("keeps the turn going when the starter page won't write", async () => {
    addCard({ id: "c1" });
    starter.fails = true;
    await send("c1", "go");
    expect(runner.isBusy("c1")).toBe(true);
  });
});

describe("the queue of messages, handed on", () => {
  it("does nothing for a card with nothing queued", async () => {
    addCard({ id: "c1" });
    const hooks = (await import("./runner-state")).hooks;
    hooks.sendQueued("c1");
    await flush();
    expect(runner.isBusy("c1")).toBe(false);
    expect(thread("c1").filter((i) => i.kind === "user")).toHaveLength(0);
  });
});

