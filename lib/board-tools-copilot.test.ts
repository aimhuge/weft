import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingPermission, Question, ThreadItem } from "./types";

// The copilot's board tools (lib/board-tools.ts boardMcpServer): the tools it can call, what each
// one does, and what it refuses. The fakes live in lib/board-tools.harness.ts, shared with
// lib/board-tools.test.ts.
const state = await vi.hoisted(async () => (await import("./board-tools.harness")).boardState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./board-tools.harness")).sdkMock(state));
vi.mock("./store", async () => (await import("./board-tools.harness")).storeMock(state));
vi.mock("./restart-when-idle", () => ({ armRestart: vi.fn() }));
vi.mock("./copilot-setup", async () => (await import("./board-tools.harness")).copilotSetupMock(state));
vi.mock("./copilot-sources", async () => (await import("./board-tools.harness")).copilotSourcesMock(state));
vi.mock("./tag-store", async () => (await import("./board-tools.harness")).tagStoreMock(state));
vi.mock("./settings", async () => (await import("./board-tools.harness")).settingsMock(state));
vi.mock("./folders", async () => (await import("./board-tools.harness")).foldersMock());

const { card, capturedTool, fakeActions, nth, reset, textOf } = await import("./board-tools.harness");
const { COPILOT_PROMPT, boardMcpServer } = await import("./board-tools");
const { CRON_TOOL_NAMES } = await import("./cron-types");

beforeEach(() => {
  reset(state);
});

describe("boardMcpServer (copilot)", () => {
  it("registers the full set of board tools for the copilot", () => {
    boardMcpServer(fakeActions());
    const names = ["list_cards", "read_thread", "create_card", "set_tags", "start_card", "send_message", "move_card", "stop_card", "setup_status", "answer_permission", ...CRON_TOOL_NAMES, "create_agent"];
    expect(state.captures.map((t) => t.name)).toEqual(names);
  });

  it("exposes the copilot prompt with the board-tool description", () => {
    expect(COPILOT_PROMPT).toContain("Weft copilot");
    expect(COPILOT_PROMPT).toContain("mcp__board__*");
  });

  it("create_cron from the copilot has no thread to fork, so it makes a fresh one", async () => {
    boardMcpServer(fakeActions());
    // The copilot has no card of its own, so the cron's getCardId() answers with nothing.
    const r = await capturedTool(state, "create_cron").handler({ prompt: "check the build", schedule: "0 9 * * *" });
    expect(textOf(r)).toMatch(/^Created cron /);
  });

  it("read_thread formats a thread and reports when it's empty", async () => {
    state.cardStore.set("c1", card(state, { id: "c1", title: "T" }));
    boardMcpServer(fakeActions());
    const empty = await capturedTool(state, "read_thread").handler({ card_id: "c1", last: 10 });
    expect(textOf(empty)).toContain("(empty thread)");

    state.threadStore.set("c1", [
      { kind: "user", text: "hi", at: 0 },
      { kind: "assistant", text: "hello", at: 0 },
      { kind: "tool", id: "t1", name: "Bash", summary: "ls", at: 0, isError: false },
      { kind: "tool", id: "t2", name: "Bash", summary: "rm -rf /", at: 0, isError: true },
      { kind: "permission", id: "p1", toolName: "Bash", title: "run ls", at: 0 },
      { kind: "permission", id: "p2", toolName: "Bash", title: "run rm", at: 0, decision: "deny" },
      { kind: "result", text: "ok", at: 0, isError: false },
      { kind: "result", text: "boom", at: 0, isError: true },
    ] as ThreadItem[]);
    const r = await capturedTool(state, "read_thread").handler({ card_id: "c1", last: 10 });
    const text = textOf(r);
    expect(text).toContain("USER: hi");
    expect(text).toContain("AGENT: hello");
    expect(text).toContain("TOOL Bash ls");
    expect(text).toContain("TOOL Bash rm -rf / (failed)");
    expect(text).toContain("PERMISSION run ls: waiting");
    expect(text).toContain("PERMISSION run rm: deny");
    expect(text).toContain("TURN FINISHED");
    expect(text).toContain("TURN ENDED: boom");
  });

  it("read_thread caps to the last N items", async () => {
    state.cardStore.set("c1", card(state, { id: "c1" }));
    state.threadStore.set("c1", [
      { kind: "user", text: "1", at: 0 },
      { kind: "user", text: "2", at: 0 },
      { kind: "user", text: "3", at: 0 },
      { kind: "user", text: "4", at: 0 },
    ] as ThreadItem[]);
    boardMcpServer(fakeActions());
    const r = await capturedTool(state, "read_thread").handler({ card_id: "c1", last: 2 });
    const text = textOf(r);
    expect(text).toContain("USER: 3");
    expect(text).toContain("USER: 4");
    expect(text).not.toContain("USER: 1");
    expect(text).not.toContain("USER: 2");
  });

  it("read_thread defaults to the last 30 items when last is omitted", async () => {
    state.cardStore.set("c1", card(state, { id: "c1" }));
    state.threadStore.set(
      "c1",
      Array.from({ length: 35 }, (_, i) => ({ kind: "user", text: `m${i}`, at: 0 })),
    );
    boardMcpServer(fakeActions());
    const r = await capturedTool(state, "read_thread").handler({ card_id: "c1" });
    const text = textOf(r);
    expect(text).toContain("m5"); // index 5 of the kept 30
    expect(text).toContain("m34");
    expect(text).not.toContain("m4");
  });

  it("read_thread refuses the copilot's own card and any unknown id", async () => {
    state.cardStore.set("copilot", { ...card(state, { id: "copilot" }), role: "copilot" });
    boardMcpServer(fakeActions());
    const r = await capturedTool(state, "read_thread").handler({ card_id: "copilot" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("No card copilot");

    const r2 = await capturedTool(state, "read_thread").handler({ card_id: "missing" });
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).toContain("No card missing");
  });

  it("create_card lets the copilot pick the cli, the agent and the permission mode", async () => {
    boardMcpServer(fakeActions());
    await capturedTool(state, "create_card").handler({ prompt: "X", folder: state.testRoot, cli: "puku" });
    expect(nth(state.created, 0, "created card").input).toMatchObject({ backend: "puku", permissionMode: "auto", cwd: state.testRoot });

    await capturedTool(state, "create_card").handler({ prompt: "Y", folder: state.testRoot, permission_mode: "acceptEdits" });
    expect(nth(state.created, 1, "created card").input).toMatchObject({ permissionMode: "acceptEdits" });
  });

  it("create_card stores the agent it was given, and none when it was Builder", async () => {
    boardMcpServer(fakeActions());
    await capturedTool(state, "create_card").handler({ prompt: "X", folder: state.testRoot, agent: "copywriter" });
    expect(nth(state.created, 0, "created card").input).toMatchObject({ agent: "copywriter" });
    // Builder is stored as no agent, so an old card and a new one read the same.
    await capturedTool(state, "create_card").handler({ prompt: "Y", folder: state.testRoot, agent: "builder" });
    expect(nth(state.created, 1, "created card").input).not.toHaveProperty("agent");
  });

  it("setup_status reads one folder, or the open cards' projects when given none", async () => {
    state.cardStore.set("c1", card(state, { id: "c1", cwd: "/projects/one" }));
    boardMcpServer(fakeActions());
    await capturedTool(state, "setup_status").handler({ folder: state.testRoot });
    expect(state.setupReport).toHaveBeenLastCalledWith([state.testRoot]);
    expect(state.activeProjects).not.toHaveBeenCalled();

    await capturedTool(state, "setup_status").handler({});
    expect(state.activeProjects).toHaveBeenCalledWith([...state.cardStore.values()]);
    expect(state.setupReport).toHaveBeenLastCalledWith(state.activeProjects([...state.cardStore.values()]));
  });

  it("create_card tags the card as the user's, and adds new tags to the catalog", async () => {
    boardMcpServer(fakeActions());
    await capturedTool(state, "create_card").handler({ prompt: "X", folder: state.testRoot, tags: ["#Bug", "bug", " "] });
    expect(nth(state.created, 0, "created card").input).toMatchObject({ tags: ["bug"], tagsBy: "user" });
    expect(state.remembered).toEqual([["bug"]]);
    // No tags, or only blank ones: nothing about tags on the card.
    await capturedTool(state, "create_card").handler({ prompt: "Y", folder: state.testRoot, tags: [" "] });
    expect(nth(state.created, 1, "created card").input).not.toHaveProperty("tags");
  });

  it("set_tags replaces a card's tags, or clears them, and refuses the copilot's own card", async () => {
    state.cardStore.set("a", card(state, { id: "a", title: "A", tags: ["old"], tagsBy: "auto" }));
    state.cardStore.set("copilot", card(state, { id: "copilot", role: "copilot" }));
    boardMcpServer(fakeActions());
    expect(textOf(await capturedTool(state, "set_tags").handler({ card_id: "a", tags: ["UI", "launch"] }))).toBe("Tagged “A”: ui, launch.");
    expect(state.cardStore.get("a")).toMatchObject({ tags: ["ui", "launch"], tagsBy: "user" });
    expect(textOf(await capturedTool(state, "set_tags").handler({ card_id: "a", tags: [] }))).toBe("Cleared “A”'s tags.");
    expect(state.cardStore.get("a")?.tags).toEqual([]);
    expect((await capturedTool(state, "set_tags").handler({ card_id: "copilot", tags: ["x"] })).isError).toBe(true);
  });

  it("start_card moves from Backlog to Running via the first message and refuses other columns", async () => {
    state.cardStore.set("a", card(state, { id: "a", column: "backlog", prompt: "Do it" }));
    const start = vi.fn();
    boardMcpServer({ start, stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const r = await capturedTool(state, "start_card").handler({ card_id: "a" });
    expect(textOf(r)).toBe("Started “Fix the bug”.");
    expect(start).toHaveBeenCalledWith("a", "Do it");

    state.cardStore.set("b", card(state, { id: "b", column: "review" }));
    const r2 = await capturedTool(state, "start_card").handler({ card_id: "b" });
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).toContain("not Backlog");
  });

  it("send_message calls actions.start with the text and the card's id", async () => {
    state.cardStore.set("a", card(state, { id: "a" }));
    const start = vi.fn();
    boardMcpServer({ start, stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const r = await capturedTool(state, "send_message").handler({ card_id: "a", text: "continue" });
    expect(textOf(r)).toBe("Sent to “Fix the bug”.");
    expect(start).toHaveBeenCalledWith("a", "continue");
  });

  it("move_card calls updateCard and refuses to move a busy card", async () => {
    state.cardStore.set("a", card(state, { id: "a", column: "review" }));
    let busy = false;
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => busy });
    const r = await capturedTool(state, "move_card").handler({ card_id: "a", column: "done" });
    expect(textOf(r)).toBe("Moved “Fix the bug” to done.");
    expect(state.cardStore.get("a")!.column).toBe("done");
    expect(state.updated.some((u) => u.id === "a" && u.patch.column === "done")).toBe(true);

    busy = true;
    const r2 = await capturedTool(state, "move_card").handler({ card_id: "a", column: "backlog" });
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).toContain("is running");
  });

  it("stop_card calls actions.stop and returns a confirmation", async () => {
    state.cardStore.set("a", card(state, { id: "a" }));
    const stop = vi.fn().mockResolvedValue(undefined);
    boardMcpServer({ start: vi.fn(), stop, answer: vi.fn(), isBusy: () => false });
    const r = await capturedTool(state, "stop_card").handler({ card_id: "a" });
    expect(textOf(r)).toBe("Stopped “Fix the bug”.");
    expect(stop).toHaveBeenCalledWith("a");
  });

  it("answer_permission routes to actions.answer with the right args, building answers from a question", async () => {
    const questions: Question[] = [{ question: "color?", options: [{ label: "red" }] }];
    const pending: PendingPermission = { id: "p1", toolName: "AskUserQuestion", title: "q", input: {}, questions };
    state.cardStore.set("a", card(state, { id: "a", pending }));
    const answer = vi.fn();
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer, isBusy: () => false });
    const r = await capturedTool(state, "answer_permission").handler({ card_id: "a", allow: true, answer: "red" });
    expect(textOf(r)).toBe("Allowed on “Fix the bug”.");
    expect(answer).toHaveBeenCalledWith("a", true, { "color?": "red" });

    const r2 = await capturedTool(state, "answer_permission").handler({ card_id: "a", allow: false });
    expect(textOf(r2)).toBe("Denied on “Fix the bug”.");
    expect(answer.mock.calls[1]).toEqual(["a", false, undefined]);
  });
});
