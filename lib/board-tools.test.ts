import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingPermission } from "./types";

// The board tools (lib/board-tools.ts): the thread's own tools and the trust rules around them.
// The copilot's tools live in lib/board-tools-copilot.test.ts; the fakes are shared.
const state = await vi.hoisted(async () => (await import("./board-tools.harness")).boardState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./board-tools.harness")).sdkMock(state));
vi.mock("./store", async () => (await import("./board-tools.harness")).storeMock(state));
vi.mock("./restart-when-idle", () => ({ armRestart: vi.fn() }));
vi.mock("./copilot-setup", async () => (await import("./board-tools.harness")).copilotSetupMock(state));
vi.mock("./copilot-sources", async () => (await import("./board-tools.harness")).copilotSourcesMock(state));
vi.mock("./tag-store", async () => (await import("./board-tools.harness")).tagStoreMock(state));
vi.mock("./settings", async () => (await import("./board-tools.harness")).settingsMock(state));
vi.mock("./folders", async () => (await import("./board-tools.harness")).foldersMock());

const { card, capturedTool, nth, reset, textOf } = await import("./board-tools.harness");
const { SAFE_BOARD_TOOLS, boardMcpServer, createBoardCard, describeBoardTool, isTrustedTool, weftMcpServer } = await import("./board-tools");
const { CRON_TOOL_NAMES } = await import("./cron-types");

beforeEach(() => {
  // Every test gets its own real directory so the boards-tools.ts createBoardCard path can be
  // exercised end-to-end against the real folders.resolveFolder (only the "missing dir" test
  // deliberately points at a path that doesn't exist).
  reset(state);
});

describe("createBoardCard", () => {
  it("titles from the prompt, resolves the folder and records the parent", () => {
    const c = createBoardCard({ prompt: "Fix the flicker", folder: state.testRoot, permissionMode: "default", parentId: "p1" });
    expect(c).toMatchObject({ title: "Fix the flicker", cwd: state.testRoot, backend: "claude", parentId: "p1" });
    expect(state.touched).toEqual([state.testRoot]);
  });

  it("keeps an explicit title and cli", () => {
    const c = createBoardCard({ prompt: "x", title: " Mine ", folder: state.testRoot, cli: "puku", permissionMode: "auto" });
    expect(c).toMatchObject({ title: "Mine", backend: "puku", permissionMode: "auto" });
  });

  it("rejects a folder that doesn't exist, creating nothing", () => {
    expect(() => createBoardCard({ prompt: "x", folder: "/no/such/dir", permissionMode: "default" })).toThrow();
    expect(state.created).toHaveLength(0);
  });
});

describe("isTrustedTool", () => {
  it("trusts Weft's own in-process tools: the browser pane and the safe board tools", () => {
    expect(isTrustedTool("mcp__browser__navigate", "sdk")).toBe(true);
    expect(isTrustedTool("mcp__board__list_cards", "sdk")).toBe(true);
    expect(isTrustedTool("mcp__board__create_card", "sdk") && isTrustedTool("mcp__secrets__fill_field", "sdk") && isTrustedTool("mcp__webhooks__add_blank", "sdk")).toBe(true);
    expect([isTrustedTool("mcp__board_view__click", "sdk"), isTrustedTool("mcp__board_view__click", "stdio")]).toEqual([true, false]);
  });

  it("asks for board tools that run agents, and for anything else", () => {
    expect(isTrustedTool("mcp__board__start_card", "sdk")).toBe(false);
    expect(isTrustedTool("mcp__board__reply", "sdk")).toBe(false);
    expect(isTrustedTool("Bash", "sdk")).toBe(false);
  });

  it("never trusts a tool from a server that isn't in-process, whatever its name", () => {
    expect(isTrustedTool("mcp__browser__navigate", "stdio") || isTrustedTool("mcp__secrets__fill_field", "stdio") || isTrustedTool("mcp__webhooks__relay", "stdio")).toBe(false);
    expect(isTrustedTool("mcp__board__list_cards", undefined)).toBe(false);
  });
});

describe("describeBoardTool", () => {
  it("labels the three tools that need the user's OK with the card's title", () => {
    state.cardStore.set("c1", card(state, { title: "Bug fix" }));
    expect(describeBoardTool("mcp__board__start_card", { card_id: "c1" })).toBe("Start “Bug fix”");
    expect(describeBoardTool("mcp__board__send_message", { card_id: "c1", text: "hi" })).toBe(
      "Reply to “Bug fix”: hi",
    );
    expect(describeBoardTool("mcp__board__answer_permission", { card_id: "c1", allow: true })).toBe(
      "Allow its request on “Bug fix”",
    );
  });

  it("clips long replies and falls back to a stringified id when the card is gone", () => {
    const long = "x".repeat(200);
    expect(describeBoardTool("mcp__board__send_message", { card_id: "missing", text: long })).toContain("…");
    // card_id present but unknown: label is the id string, not the generic "a card".
    expect(describeBoardTool("mcp__board__start_card", { card_id: "missing" })).toBe("Start missing");
    // No card_id at all: label is the generic "a card".
    expect(describeBoardTool("mcp__board__start_card", {})).toBe("Start a card");
  });

  it("uses the pending title when denying a permission", () => {
    state.cardStore.set("c1", card(state, { title: "Bug fix" }));
    const pending: PendingPermission = { id: "p1", toolName: "Bash", title: "run rm -rf", input: {} };
    state.cardStore.set("c1", { ...state.cardStore.get("c1")!, pending });
    expect(describeBoardTool("mcp__board__answer_permission", { card_id: "c1", allow: false })).toBe(
      'Deny run rm -rf on “Bug fix”',
    );
  });

  it("returns null for tools that don't need a confirmation", () => {
    expect(describeBoardTool("mcp__board__list_cards", {})).toBeNull();
    expect(describeBoardTool("mcp__board__create_card", { prompt: "x" })).toBeNull();
    expect(describeBoardTool("mcp__browser__navigate", { url: "x" })).toBeNull();
  });

  it("send_message uses a placeholder when text is missing", () => {
    // A copilot or thread that calls send_message without a text field: the description is
    // built from String(undefined ?? "") = "".
    state.cardStore.set("c1", card(state, { title: "Bug fix" }));
    expect(describeBoardTool("mcp__board__send_message", { card_id: "c1" })).toBe("Reply to “Bug fix”: ");
  });

  it("list_cards shows remaining, pending and error on the card's line; neither shows a cost", async () => {
    state.cardStore.set(
      "c1",
      card(state, { id: "c1", title: "Big", remaining: "add tests", error: "boom\nstack trace", costUsd: 1.23 }),
    );
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const r1 = await capturedTool(state, "list_cards").handler({});
    const text1 = textOf(r1);
    expect(text1).toContain("remaining: add tests");
    expect(text1).toContain("error: boom");
    expect(text1).not.toContain("stack trace");
    expect(text1).not.toContain("cost");
    const full = await capturedTool(state, "read_thread").handler({ card_id: "c1", last: 1 });
    expect(textOf(full)).not.toContain("$1.23");
    // pending set non-null also shows.
    state.cardStore.set("c1", card(state, { id: "c1", title: "Big", pending: { id: "p", toolName: "Bash", title: "ask", input: {} } }));
    const r2 = await capturedTool(state, "list_cards").handler({});
    expect(textOf(r2)).toContain("waiting on: ask");
  });

  it("attempt() falls back to String(err) for non-Error throws", async () => {
    // Make the start action throw a plain string, which is an unusual but real possibility (anything
    // thrown in user code could be a string). The MCP wrapper should still surface it.
    state.cardStore.set("a", card(state, { id: "a", column: "backlog" }));
    boardMcpServer({
      start: () => {
        const thrown: unknown = "string error";
        throw thrown;
      },
      stop: async () => {},
      answer: vi.fn(),
      isBusy: () => false,
    });
    const r = await capturedTool(state, "start_card").handler({ card_id: "a" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("string error");
  });
});

describe("weftMcpServer", () => {
  it("create_card on a board thread takes tags too", async () => {
    weftMcpServer(() => undefined, { start: vi.fn() });
    await capturedTool(state, "create_card").handler({ prompt: "x", folder: state.testRoot, start: false, tags: ["Docs"] });
    expect(nth(state.created, 0, "created card").input).toMatchObject({ tags: ["docs"], tagsBy: "user" });
  });

  it("registers only list_cards, create_card, restart_weft_when_idle, request_folder_access, the changelog, the crons, the skill tools and create_agent (no read, start, send, move, stop, answer)", () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    expect(state.captures.map((t) => t.name)).toEqual([
      "list_cards", "create_card", "restart_weft_when_idle", "request_folder_access", "changelog_add", "changelog_list", "changelog_edit",
      ...CRON_TOOL_NAMES,
      "skill_preview", "skill_review", "skill_install",
      "create_agent",
    ]);
    expect(["list_cards", "create_card"].every((name) => SAFE_BOARD_TOOLS.has(name))).toBe(true);
    expect(SAFE_BOARD_TOOLS.has("start_card")).toBe(false);
  });

  it("list_cards returns 'No cards' when the board is empty, and a card's metadata when there is one", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    const empty = await capturedTool(state, "list_cards").handler({});
    expect(textOf(empty)).toBe("No cards.");
    expect(empty.isError).toBeUndefined();

    state.cardStore.set("c1", card(state, { title: "A", stage: "First shot", lastLine: "WIP" }));
    const withOne = await capturedTool(state, "list_cards").handler({});
    expect(textOf(withOne)).toBe(`c1 | backlog | A | ${state.testRoot} | First shot | latest: WIP`);
  });

  it("list_cards prints one line per card and clips latest to its first short line", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    const long = `${"word ".repeat(60)}\nsecond line`;
    state.cardStore.set("a", card(state, { id: "a", lastLine: long }));
    state.cardStore.set("b", card(state, { id: "b", lastLine: "\n  done here  \nmore" }));
    const text = textOf(await capturedTool(state, "list_cards").handler({}));
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.find((l: string) => l.startsWith("a "))).toMatch(/latest: (word ){15}.*…$/);
    expect(lines.find((l: string) => l.startsWith("a "))!.length).toBeLessThan(200);
    expect(text).toContain("latest: done here");
    expect(text).not.toContain("second line");
  });

  it("list_cards marks starred cards with ★ and shows tags, only when a card has some", async () => {
    weftMcpServer(() => undefined, { start: vi.fn() });
    state.cardStore.set("a", card(state, { id: "a", title: "Kept", starred: true, tags: ["bug fix", "ui"] }));
    state.cardStore.set("b", card(state, { id: "b", title: "Plain", tags: [] }));
    const lines = textOf(await capturedTool(state, "list_cards").handler({})).split("\n");
    expect(lines.find((l) => l.startsWith("a "))).toContain("| ★ Kept | ");
    expect(lines.find((l) => l.startsWith("a "))).toContain("| tags: bug fix, ui");
    expect(lines.find((l) => l.startsWith("b "))).not.toMatch(/★|tags:/);
  });

  it("list_cards leaves out done and archived cards by default and says how many", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    state.cardStore.set("a", card(state, { id: "a", column: "running" }));
    state.cardStore.set("b", card(state, { id: "b", column: "done" }));
    state.cardStore.set("c", card(state, { id: "c", column: "review", archived: true }));
    const text = textOf(await capturedTool(state, "list_cards").handler({}));
    expect(text.split("\n")).toEqual([
      expect.stringMatching(/^a \| running/),
      "2 done or archived left out; pass include_done=true to list them.",
    ]);
  });

  it("list_cards lists done and archived cards with include_done, alone or with a column", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    state.cardStore.set("a", card(state, { id: "a", column: "running", updatedAt: 3 }));
    state.cardStore.set("b", card(state, { id: "b", column: "done", updatedAt: 2 }));
    state.cardStore.set("c", card(state, { id: "c", column: "review", archived: true, updatedAt: 1 }));
    const every = textOf(await capturedTool(state, "list_cards").handler({ include_done: true }));
    expect(every.split("\n").map((l: string) => l.split(" ")[0])).toEqual(["a", "b", "c"]);
    const done = textOf(await capturedTool(state, "list_cards").handler({ column: "done", include_done: true }));
    expect(done).toMatch(/^b \| done[^\n]*$/);
    const review = textOf(await capturedTool(state, "list_cards").handler({ column: "review" }));
    expect(review).toBe("No open cards in review.\n1 done or archived left out; pass include_done=true to list them.");
  });

  it("list_cards says 'No open cards' when only done ones are on the board", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    state.cardStore.set("b", card(state, { id: "b", column: "done" }));
    const text = textOf(await capturedTool(state, "list_cards").handler({}));
    expect(text).toBe("No open cards.\n1 done or archived left out; pass include_done=true to list them.");
  });

  it("list_cards lists newest first, up to limit, and counts the rest", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    for (let i = 0; i < 5; i++) state.cardStore.set(`k${i}`, card(state, { id: `k${i}`, updatedAt: i }));
    const lines = textOf(await capturedTool(state, "list_cards").handler({ limit: 2 })).split("\n");
    expect(lines).toEqual([
      expect.stringMatching(/^k4 /),
      expect.stringMatching(/^k3 /),
      "3 more not shown; raise limit or pass column.",
    ]);
  });

  it("list_cards keeps the default under the tool-result limit on a big board", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    for (let i = 0; i < 300; i++) {
      state.cardStore.set(`k${i}`, card(state, { id: `k${i}`, column: i % 2 ? "done" : "review", lastLine: "x".repeat(2000), remaining: "y".repeat(500) }));
    }
    const text = textOf(await capturedTool(state, "list_cards").handler({}));
    expect(text.length).toBeLessThan(15_000);
  });

  it("list_cards says 'No cards in <column>' when the column filter matches nothing", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    const r = await capturedTool(state, "list_cards").handler({ column: "done" });
    expect(textOf(r)).toBe("No cards in done.");
  });

  it("list_cards filters by column when asked", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    state.cardStore.set("a", card(state, { id: "a", column: "backlog" }));
    state.cardStore.set("b", card(state, { id: "b", column: "review" }));
    const r = await capturedTool(state, "list_cards").handler({ column: "review" });
    expect(textOf(r)).toMatch(/^b \| review/);
    expect(textOf(r)).not.toMatch(/^a /m);
  });

  it("create_card on a board thread inherits the parent's folder, permission mode, and id", async () => {
    state.cardStore.set("parent-1", card(state, { id: "parent-1", cwd: state.testRoot, permissionMode: "bypassPermissions" }));
    const start = vi.fn();
    weftMcpServer(() => "parent-1", { start });
    const r = await capturedTool(state, "create_card").handler({ prompt: "Refactor", title: "Refactor", folder: undefined, start: true });
    expect(textOf(r)).toMatch(/^Created and started c\d+: Refactor$/);
    const input = nth(state.created, 0, "created card").input;
    expect(input).toMatchObject({ prompt: "Refactor", title: "Refactor", cwd: state.testRoot, parentId: "parent-1", permissionMode: "bypassPermissions" });
    expect(start).toHaveBeenCalledTimes(1);
    expect(nth(start.mock.calls, 0, "start call")[1]).toBe("Refactor"); // firstMessage(card) when no start automations: just the prompt
  });

  it("create_card uses defaults when there's no parent yet (spare CLI)", async () => {
    const start = vi.fn();
    weftMcpServer(() => undefined, { start });
    await capturedTool(state, "create_card").handler({ prompt: "Hello" });
    const input = nth(state.created, 0, "created card").input;
    // No parent cwd and no folder override: createBoardCard gets folder="", which resolveFolder
    // maps to "." (the process cwd, which is the project root — an existing dir).
    expect(input).toMatchObject({ prompt: "Hello", permissionMode: "auto", parentId: undefined });
    expect(typeof input.cwd).toBe("string");
    expect(input.cwd).not.toBe("");
  });

  it("create_card with start=false leaves the card in Backlog and doesn't call actions.start", async () => {
    const start = vi.fn();
    weftMcpServer(() => undefined, { start });
    const r = await capturedTool(state, "create_card").handler({ prompt: "x", start: false });
    expect(textOf(r)).toMatch(/^Created c\d+ in Backlog: /);
    expect(start).not.toHaveBeenCalled();
  });

  it("changelog_list without a card or folder says there is no project, using the default cwd", async () => {
    // A spare CLI has no card yet and no folder to fall back on, so the default getCwd
    // (an empty string) is what the project lookup ends up with.
    weftMcpServer(() => undefined, { start: vi.fn() });
    const r = await capturedTool(state, "changelog_list").handler({});
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("No project folder");
  });
});


describe("createBoardCard ↔ tool handler integration", () => {
  it("the thread tool's create_card calls createBoardCard and then actions.start with the prompt", async () => {
    state.cardStore.set("parent-1", card(state, { id: "parent-1", cwd: state.testRoot, permissionMode: "default" }));
    const start = vi.fn();
    weftMcpServer(() => "parent-1", { start });
    await capturedTool(state, "create_card").handler({ prompt: "Hi" });
    expect(nth(state.created, 0, "created card").input).toMatchObject({ prompt: "Hi", cwd: state.testRoot, parentId: "parent-1" });
    expect(start).toHaveBeenCalledWith(nth(state.created, 0, "created card").out.id, "Hi");
  });
});

describe("read_thread card header", () => {
  it("lists the card's stage, latest line and what it waits on before the thread", async () => {
    state.cardStore.set(
      "c1",
      card(state, { id: "c1", column: "needs_you", stage: "First shot", lastLine: "Which db?", pending: { id: "p", toolName: "Bash", title: "Run npm test", input: {} } }),
    );
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const text = textOf(await capturedTool(state, "read_thread").handler({ card_id: "c1" }));
    const header = nth(text.split("\n\n---\n\n"), 0, "section").split("\n");
    expect(header).toEqual(expect.arrayContaining(["stage: First shot", "latest: Which db?", "waiting on the user for: Run npm test"]));
  });
});
