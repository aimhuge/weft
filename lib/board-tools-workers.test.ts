import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, PendingPermission } from "./types";

// The board tools on this Mac reaching a Weft Worker's card (lib/board-tools-copilot.ts, lib/board-tools.ts): every act
// goes to the worker as a host verb through the fake WorkerReach, and this Mac's store is never written. The fakes live
// in lib/board-tools.harness.ts; lib/board-tools-copilot.test.ts covers the same tools on this Mac's cards.
const state = await vi.hoisted(async () => (await import("./board-tools.harness")).boardState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./board-tools.harness")).sdkMock(state));
vi.mock("./store", async () => (await import("./board-tools.harness")).storeMock(state));
vi.mock("./restart-when-idle", () => ({ armRestart: vi.fn() }));
vi.mock("./copilot-setup", async () => (await import("./board-tools.harness")).copilotSetupMock(state));
vi.mock("./copilot-sources", async () => (await import("./board-tools.harness")).copilotSourcesMock(state));
vi.mock("./tag-store", async () => (await import("./board-tools.harness")).tagStoreMock(state));
vi.mock("./settings", async () => (await import("./board-tools.harness")).settingsMock(state));
vi.mock("./folders", async () => (await import("./board-tools.harness")).foldersMock());
vi.mock("./worker-board-reach", async () => (await import("./board-tools.harness")).reachMock(state));
vi.mock("./worker-pane", async (load) => ({ ...(await load<typeof import("./worker-pane")>()), onWorker: () => false }));

const { capturedTool, fakeActions, reset, textOf } = await import("./board-tools.harness");
const { boardMcpServer, weftMcpServer } = await import("./board-tools");
const { WORKER_AGENT_REFUSED } = await import("./board-tools-hosts");
const { workerProjectPath } = await import("./worker-project");

const APP = workerProjectPath("w1", "app");
const pending: PendingPermission = { id: "p1", toolName: "AskUserQuestion", title: "Which?", input: {}, questions: [{ question: "Which?", header: "", options: [], multiSelect: false }] };
const there = (over: Partial<Card> = {}): Card =>
  ({ id: "wc", title: "On the worker", prompt: "Do it", cwd: APP, backend: "claude", permissionMode: "acceptEdits", column: "backlog", createdAt: 0, updatedAt: 0, ...over });
let actions: ReturnType<typeof fakeActions>;

const run = (name: string, args: Record<string, unknown>) => capturedTool(state, name).handler(args);
const acts = () => state.reach.act.mock.calls;

beforeEach(() => {
  reset(state);
  actions = fakeActions();
  state.reach.board.mockResolvedValue({ cards: [there()], projects: [] });
  boardMcpServer(actions);
});

// Nothing ran on this Mac: no runner call and no store write.
function nothingHere() {
  expect(actions.start).not.toHaveBeenCalled();
  expect(actions.stop).not.toHaveBeenCalled();
  expect(actions.answer).not.toHaveBeenCalled();
  expect(state.updated).toEqual([]);
}

describe("the copilot's tools on a worker's card", () => {
  it("list_cards and read_thread show the worker's card", async () => {
    expect(textOf(await run("list_cards", {}))).toContain(`wc | backlog | On the worker | ${APP}`);
    state.reach.page.mockResolvedValue({ items: [{ kind: "user", text: "hello", at: 0 }], start: 0, total: 1 });
    expect(textOf(await run("read_thread", { card_id: "wc" }))).toContain("USER: hello");
  });

  it("start_card sends the first message as card.message, and only from Backlog", async () => {
    expect(textOf(await run("start_card", { card_id: "wc" }))).toBe("Started “On the worker”.");
    expect(acts()).toEqual([["wc", "card.message", { text: "Do it" }]]);
    state.reach.board.mockResolvedValue({ cards: [there({ column: "review" })], projects: [] });
    const r = await run("start_card", { card_id: "wc" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("is in review, not Backlog");
    nothingHere();
  });

  it("send_message and stop_card go as card.message and card.stop, saying when they're queued", async () => {
    expect(textOf(await run("send_message", { card_id: "wc", text: "go on" }))).toBe("Sent to “On the worker”.");
    state.reach.act.mockResolvedValue({ queued: true });
    expect(textOf(await run("stop_card", { card_id: "wc" }))).toBe("Stopped “On the worker”. Its worker hasn't taken it yet: it happens once that worker is back.");
    expect(acts()).toEqual([["wc", "card.message", { text: "go on" }], ["wc", "card.stop", {}]]);
    nothingHere();
  });

  it("move_card moves it with card.update's column alone, but not while it runs", async () => {
    expect(textOf(await run("move_card", { card_id: "wc", column: "done" }))).toBe("Moved “On the worker” to done.");
    expect(acts()).toEqual([["wc", "card.update", { body: { column: "done" } }]]);
    state.reach.board.mockResolvedValue({ cards: [there({ column: "running" })], projects: [] });
    expect(textOf(await run("move_card", { card_id: "wc", column: "done" }))).toBe("“On the worker” is running. Stop it first.");
    expect(acts()).toHaveLength(1);
    nothingHere();
  });

  it("set_tags sends the tags alone", async () => {
    expect(textOf(await run("set_tags", { card_id: "wc", tags: ["Bug"] }))).toBe("Tagged “On the worker”: bug.");
    expect(textOf(await run("set_tags", { card_id: "wc", tags: [] }))).toBe("Cleared “On the worker”'s tags.");
    expect(acts()).toEqual([["wc", "card.update", { body: { tags: ["bug"] } }], ["wc", "card.update", { body: { tags: [] } }]]);
    nothingHere();
  });

  it("answer_permission answers the request it's waiting on, with the question's answer", async () => {
    const r0 = await run("answer_permission", { card_id: "wc", allow: true });
    expect(textOf(r0)).toBe("“On the worker” isn't waiting on an answer.");
    state.reach.board.mockResolvedValue({ cards: [there({ column: "needs_you", pending })], projects: [] });
    expect(textOf(await run("answer_permission", { card_id: "wc", allow: true, answer: "B" }))).toBe("Allowed on “On the worker”.");
    expect(textOf(await run("answer_permission", { card_id: "wc", allow: false }))).toBe("Denied on “On the worker”.");
    expect(acts()).toEqual([
      ["wc", "card.permission.answer", { allow: true, pendingId: "p1", answers: { "Which?": "B" } }],
      ["wc", "card.permission.answer", { allow: false, pendingId: "p1" }],
    ]);
    nothingHere();
  });

  it("a worker's refusal comes back as the tool's error", async () => {
    state.reach.act.mockRejectedValue(new Error("A request from the web can't skip permission prompts."));
    const r = await run("send_message", { card_id: "wc", text: "x" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("can't skip permission prompts");
  });

  it("create_card into a worker project lands in that worker's Backlog in default mode", async () => {
    const r = await run("create_card", { prompt: "New", folder: APP, permission_mode: "bypassPermissions", cli: "codex" });
    expect(textOf(r)).toMatch(/^Created w-\d+ in Backlog on m1mini/);
    expect(state.reach.start).toHaveBeenCalledWith(expect.objectContaining({ cwd: APP, prompt: "New", backend: "codex", permissionMode: "default", start: false }));
    expect(state.created).toEqual([]);
  });
});

describe("a thread's create_card on this Mac", () => {
  beforeEach(() => {
    state.captures.length = 0;
    weftMcpServer(() => undefined, actions);
  });

  it("starts the card on the worker a worker:// folder names, never here", async () => {
    expect(textOf(await run("create_card", { prompt: "Build it", folder: APP, tags: ["x"] }))).toMatch(/^Created and started w-\d+ on m1mini/);
    expect(state.reach.start).toHaveBeenCalledWith(expect.objectContaining({ cwd: APP, permissionMode: "default", start: true, tags: ["x"] }));
    expect(state.created).toEqual([]);
    expect(actions.start).not.toHaveBeenCalled();
  });

  it("refuses an agent for a worker card", async () => {
    const r = await run("create_card", { prompt: "Write", folder: APP, agent: "copywriter" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe(WORKER_AGENT_REFUSED);
    expect(state.reach.start).not.toHaveBeenCalled();
  });

  it("keeps a folder on this Mac here", async () => {
    expect(textOf(await run("create_card", { prompt: "Local", folder: state.testRoot }))).toMatch(/^Created and started c1/);
    expect(state.reach.start).not.toHaveBeenCalled();
  });
});
