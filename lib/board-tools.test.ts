import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Card, PendingPermission, Question, ThreadItem } from "./types";

// Capture every tool the SDK MCP server registers, so the tests can call each handler directly.
// The handler signature is (args, extra) -> { content, isError? } in MCP; the board wraps the result
// in attempt() (board-tools.ts), which catches errors and isError: true. The same shape comes back.
interface CapturedTool {
  name: string;
  description: string;
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: true }>;
}

const captures: CapturedTool[] = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: (options: { tools?: CapturedTool[] }) => {
    for (const t of options.tools ?? []) captures.push(t);
    return { name: "board" };
  },
  // tool() returns an SdkMcpToolDefinition; tests just need its handler and metadata.
  tool: (name: string, description: string, _schema: unknown, handler: CapturedTool["handler"]) => ({
    name,
    description,
    handler,
  }),
}));

// An in-memory store fake. Tests seed it with cards, watch what gets created, and replaceThreadItem
// just appends a tool result so a test can read it back.
const cardStore = new Map<string, Card>();
const threadStore = new Map<string, ThreadItem[]>();
const created: { input: Record<string, unknown>; out: Card }[] = [];
const updated: { id: string; patch: Partial<Card> }[] = [];

vi.mock("./store", () => ({
  // The cron tools (lib/cron-tools.ts) reach modules that read the data folder as they load.
  DATA_DIR: "/tmp/weft-board-tools-test",
  createCard: (input: Record<string, unknown>) => {
    const card: Card = {
      id: `c${created.length + 1}`,
      column: "backlog",
      createdAt: 1,
      updatedAt: 1,
      ...input,
    } as Card;
    created.push({ input, out: card });
    cardStore.set(card.id, card);
    return card;
  },
  getCard: (id: string) => cardStore.get(id),
  getThread: (id: string) => threadStore.get(id) ?? [],
  listCards: () => [...cardStore.values()],
  updateCard: (id: string, patch: Partial<Card>) => {
    const card = cardStore.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch, { updatedAt: Date.now() });
    updated.push({ id, patch });
    return card;
  },
  appendThread: (id: string, item: ThreadItem) => {
    const list = threadStore.get(id) ?? [];
    list.push(item);
    threadStore.set(id, list);
    return list.length - 1;
  },
  replaceThreadItem: (id: string, index: number, item: ThreadItem) => {
    const list = threadStore.get(id) ?? [];
    list[index] = item;
    threadStore.set(id, list);
  },
}));

vi.mock("./restart-when-idle", () => ({ armRestart: vi.fn() }));
vi.mock("./copilot-setup", () => ({ setupReport: vi.fn() }));
vi.mock("./copilot-sources", () => ({ activeProjects: vi.fn() }));
// the tag catalog (lib/tag-store.ts) writes ~/.weft/tags.json; here it records what joined it
const remembered: string[][] = [];
vi.mock("./tag-store", () => ({ rememberTags: (tags: string[]) => remembered.push(tags) }));

const touched: string[] = [];
vi.mock("./settings", () => ({
  touchProject: (folder: string) => touched.push(folder),
  defaultPermissionMode: () => "auto",
  // firstMessage() in the create_card / start_card handlers reads automations(); returning []
  // keeps the first message equal to the prompt.
  automations: () => [],
}));

// folders.resolveFolder() requires an existing directory. Tests use a per-suite temp dir so the
// "not a folder" test is the only one that ever points at a missing path. The real implementation
// is short enough to mirror so we can avoid pulling fs/path through a vi.mock factory.
let testRoot: string;
vi.mock("./folders", async () => {
  const fs = await import("node:fs");
  return {
    resolveFolder: (raw: unknown) => {
      const text = typeof raw === "string" ? raw.trim() : "";
      const folder = text || ".";
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`${folder} isn't a folder.`);
      return folder;
    },
  };
});

import { COPILOT_PROMPT, SAFE_BOARD_TOOLS, boardMcpServer, createBoardCard, describeBoardTool, isTrustedTool, weftMcpServer } from "./board-tools";
import { CRON_TOOL_NAMES } from "./cron-types";

const card = (over: Partial<Card> = {}): Card =>
  ({
    id: "c1",
    title: "Fix the bug",
    prompt: "Fix the bug",
    cwd: testRoot,
    backend: "claude",
    permissionMode: "default" as const,
    column: "backlog" as const,
    createdAt: 0,
    updatedAt: 0,
    promptSkills: [],
    ...over,
  });

beforeEach(() => {
  cardStore.clear();
  threadStore.clear();
  created.length = 0;
  updated.length = 0;
  touched.length = 0;
  captures.length = 0;
  remembered.length = 0;
  // Every test gets its own real directory so the boards-tools.ts createBoardCard path can be
  // exercised end-to-end against the real folders.resolveFolder (only the "missing dir" test
  // deliberately points at a path that doesn't exist).
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weft-board-tools-"));
});

// The item at index i; throws a clear error when it doesn't exist.
function nth<T>(arr: readonly T[], i: number, what = "item"): T {
  const item = arr[i];
  if (item === undefined) throw new Error(`No ${what} at index ${String(i)} (have ${String(arr.length)})`);
  return item;
}

// The text of a tool result's first content block.
const textOf = (r: Awaited<ReturnType<CapturedTool["handler"]>>) => nth(r.content, 0, "content block").text;

function capturedTool(name: string, after = 0) {
  // Multiple servers register the same tool name (list_cards, create_card). The 'after' argument
  // picks the nth match: 0 for the first, 1 for the second.
  const matches = captures.filter((x) => x.name === name);
  const t = matches[after];
  if (!t) throw new Error(`No tool ${name} (after ${after}) captured. Captured: ${captures.map((x) => x.name).join(", ")}`);
  return t;
}

describe("createBoardCard", () => {
  it("titles from the prompt, resolves the folder and records the parent", () => {
    const c = createBoardCard({ prompt: "Fix the flicker", folder: testRoot, permissionMode: "default", parentId: "p1" });
    expect(c).toMatchObject({ title: "Fix the flicker", cwd: testRoot, backend: "claude", parentId: "p1" });
    expect(touched).toEqual([testRoot]);
  });

  it("keeps an explicit title and cli", () => {
    const c = createBoardCard({ prompt: "x", title: " Mine ", folder: testRoot, cli: "puku", permissionMode: "auto" });
    expect(c).toMatchObject({ title: "Mine", backend: "puku", permissionMode: "auto" });
  });

  it("rejects a folder that doesn't exist, creating nothing", () => {
    expect(() => createBoardCard({ prompt: "x", folder: "/no/such/dir", permissionMode: "default" })).toThrow();
    expect(created).toHaveLength(0);
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
    cardStore.set("c1", card({ title: "Bug fix" }));
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
    cardStore.set("c1", card({ title: "Bug fix" }));
    const pending: PendingPermission = { id: "p1", toolName: "Bash", title: "run rm -rf", input: {} };
    cardStore.set("c1", { ...cardStore.get("c1")!, pending });
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
    cardStore.set("c1", card({ title: "Bug fix" }));
    expect(describeBoardTool("mcp__board__send_message", { card_id: "c1" })).toBe("Reply to “Bug fix”: ");
  });

  it("list_cards shows remaining, pending and error on the card's line; neither shows a cost", async () => {
    cardStore.set(
      "c1",
      card({ id: "c1", title: "Big", remaining: "add tests", error: "boom\nstack trace", costUsd: 1.23 }),
    );
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const r1 = await capturedTool("list_cards").handler({});
    const text1 = textOf(r1);
    expect(text1).toContain("remaining: add tests");
    expect(text1).toContain("error: boom");
    expect(text1).not.toContain("stack trace");
    expect(text1).not.toContain("cost");
    const full = await capturedTool("read_thread").handler({ card_id: "c1", last: 1 });
    expect(textOf(full)).not.toContain("$1.23");
    // pending set non-null also shows.
    cardStore.set("c1", card({ id: "c1", title: "Big", pending: { id: "p", toolName: "Bash", title: "ask", input: {} } }));
    const r2 = await capturedTool("list_cards").handler({});
    expect(textOf(r2)).toContain("waiting on: ask");
  });

  it("attempt() falls back to String(err) for non-Error throws", async () => {
    // Make the start action throw a plain string, which is an unusual but real possibility (anything
    // thrown in user code could be a string). The MCP wrapper should still surface it.
    cardStore.set("a", card({ id: "a", column: "backlog" }));
    boardMcpServer({
      start: () => {
        const thrown: unknown = "string error";
        throw thrown;
      },
      stop: async () => {},
      answer: vi.fn(),
      isBusy: () => false,
    });
    const r = await capturedTool("start_card").handler({ card_id: "a" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("string error");
  });
});

describe("weftMcpServer", () => {
  it("create_card on a board thread takes tags too", async () => {
    weftMcpServer(() => undefined, { start: vi.fn() });
    await capturedTool("create_card").handler({ prompt: "x", folder: testRoot, start: false, tags: ["Docs"] });
    expect(nth(created, 0, "created card").input).toMatchObject({ tags: ["docs"], tagsBy: "user" });
  });

  it("registers only list_cards, create_card, restart_weft_when_idle, request_folder_access, the changelog, the crons and the skill tools (no read, start, send, move, stop, answer)", () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    expect(captures.map((t) => t.name)).toEqual([
      "list_cards", "create_card", "restart_weft_when_idle", "request_folder_access", "changelog_add", "changelog_list", "changelog_edit",
      ...CRON_TOOL_NAMES,
      "skill_preview", "skill_review", "skill_install",
    ]);
    expect(["list_cards", "create_card"].every((name) => SAFE_BOARD_TOOLS.has(name))).toBe(true);
    expect(SAFE_BOARD_TOOLS.has("start_card")).toBe(false);
  });

  it("list_cards returns 'No cards' when the board is empty, and a card's metadata when there is one", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    const empty = await capturedTool("list_cards").handler({});
    expect(textOf(empty)).toBe("No cards.");
    expect(empty.isError).toBeUndefined();

    cardStore.set("c1", card({ title: "A", stage: "First shot", lastLine: "WIP" }));
    const withOne = await capturedTool("list_cards").handler({});
    expect(textOf(withOne)).toBe(`c1 | backlog | A | ${testRoot} | First shot | latest: WIP`);
  });

  it("list_cards prints one line per card and clips latest to its first short line", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    const long = `${"word ".repeat(60)}\nsecond line`;
    cardStore.set("a", card({ id: "a", lastLine: long }));
    cardStore.set("b", card({ id: "b", lastLine: "\n  done here  \nmore" }));
    const text = textOf(await capturedTool("list_cards").handler({}));
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.find((l: string) => l.startsWith("a "))).toMatch(/latest: (word ){15}.*…$/);
    expect(lines.find((l: string) => l.startsWith("a "))!.length).toBeLessThan(200);
    expect(text).toContain("latest: done here");
    expect(text).not.toContain("second line");
  });

  it("list_cards marks starred cards with ★ and shows tags, only when a card has some", async () => {
    weftMcpServer(() => undefined, { start: vi.fn() });
    cardStore.set("a", card({ id: "a", title: "Kept", starred: true, tags: ["bug fix", "ui"] }));
    cardStore.set("b", card({ id: "b", title: "Plain", tags: [] }));
    const lines = textOf(await capturedTool("list_cards").handler({})).split("\n");
    expect(lines.find((l) => l.startsWith("a "))).toContain("| ★ Kept | ");
    expect(lines.find((l) => l.startsWith("a "))).toContain("| tags: bug fix, ui");
    expect(lines.find((l) => l.startsWith("b "))).not.toMatch(/★|tags:/);
  });

  it("list_cards leaves out done and archived cards by default and says how many", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    cardStore.set("a", card({ id: "a", column: "running" }));
    cardStore.set("b", card({ id: "b", column: "done" }));
    cardStore.set("c", card({ id: "c", column: "review", archived: true }));
    const text = textOf(await capturedTool("list_cards").handler({}));
    expect(text.split("\n")).toEqual([
      expect.stringMatching(/^a \| running/),
      "2 done or archived left out; pass include_done=true to list them.",
    ]);
  });

  it("list_cards lists done and archived cards with include_done, alone or with a column", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    cardStore.set("a", card({ id: "a", column: "running", updatedAt: 3 }));
    cardStore.set("b", card({ id: "b", column: "done", updatedAt: 2 }));
    cardStore.set("c", card({ id: "c", column: "review", archived: true, updatedAt: 1 }));
    const every = textOf(await capturedTool("list_cards").handler({ include_done: true }));
    expect(every.split("\n").map((l: string) => l.split(" ")[0])).toEqual(["a", "b", "c"]);
    const done = textOf(await capturedTool("list_cards").handler({ column: "done", include_done: true }));
    expect(done).toMatch(/^b \| done[^\n]*$/);
    const review = textOf(await capturedTool("list_cards").handler({ column: "review" }));
    expect(review).toBe("No open cards in review.\n1 done or archived left out; pass include_done=true to list them.");
  });

  it("list_cards says 'No open cards' when only done ones are on the board", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    cardStore.set("b", card({ id: "b", column: "done" }));
    const text = textOf(await capturedTool("list_cards").handler({}));
    expect(text).toBe("No open cards.\n1 done or archived left out; pass include_done=true to list them.");
  });

  it("list_cards lists newest first, up to limit, and counts the rest", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    for (let i = 0; i < 5; i++) cardStore.set(`k${i}`, card({ id: `k${i}`, updatedAt: i }));
    const lines = textOf(await capturedTool("list_cards").handler({ limit: 2 })).split("\n");
    expect(lines).toEqual([
      expect.stringMatching(/^k4 /),
      expect.stringMatching(/^k3 /),
      "3 more not shown; raise limit or pass column.",
    ]);
  });

  it("list_cards keeps the default under the tool-result limit on a big board", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    for (let i = 0; i < 300; i++) {
      cardStore.set(`k${i}`, card({ id: `k${i}`, column: i % 2 ? "done" : "review", lastLine: "x".repeat(2000), remaining: "y".repeat(500) }));
    }
    const text = textOf(await capturedTool("list_cards").handler({}));
    expect(text.length).toBeLessThan(15_000);
  });

  it("list_cards says 'No cards in <column>' when the column filter matches nothing", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    const r = await capturedTool("list_cards").handler({ column: "done" });
    expect(textOf(r)).toBe("No cards in done.");
  });

  it("list_cards filters by column when asked", async () => {
    weftMcpServer(() => "parent-1", { start: vi.fn() });
    cardStore.set("a", card({ id: "a", column: "backlog" }));
    cardStore.set("b", card({ id: "b", column: "review" }));
    const r = await capturedTool("list_cards").handler({ column: "review" });
    expect(textOf(r)).toMatch(/^b \| review/);
    expect(textOf(r)).not.toMatch(/^a /m);
  });

  it("create_card on a board thread inherits the parent's folder, permission mode, and id", async () => {
    cardStore.set("parent-1", card({ id: "parent-1", cwd: testRoot, permissionMode: "bypassPermissions" }));
    const start = vi.fn();
    weftMcpServer(() => "parent-1", { start });
    const r = await capturedTool("create_card").handler({ prompt: "Refactor", title: "Refactor", folder: undefined, start: true });
    expect(textOf(r)).toMatch(/^Created and started c\d+: Refactor$/);
    const input = nth(created, 0, "created card").input;
    expect(input).toMatchObject({ prompt: "Refactor", title: "Refactor", cwd: testRoot, parentId: "parent-1", permissionMode: "bypassPermissions" });
    expect(start).toHaveBeenCalledTimes(1);
    expect(nth(start.mock.calls, 0, "start call")[1]).toBe("Refactor"); // firstMessage(card) when no start automations: just the prompt
  });

  it("create_card uses defaults when there's no parent yet (spare CLI)", async () => {
    const start = vi.fn();
    weftMcpServer(() => undefined, { start });
    await capturedTool("create_card").handler({ prompt: "Hello" });
    const input = nth(created, 0, "created card").input;
    // No parent cwd and no folder override: createBoardCard gets folder="", which resolveFolder
    // maps to "." (the process cwd, which is the project root — an existing dir).
    expect(input).toMatchObject({ prompt: "Hello", permissionMode: "auto", parentId: undefined });
    expect(typeof input.cwd).toBe("string");
    expect(input.cwd).not.toBe("");
  });

  it("create_card with start=false leaves the card in Backlog and doesn't call actions.start", async () => {
    const start = vi.fn();
    weftMcpServer(() => undefined, { start });
    const r = await capturedTool("create_card").handler({ prompt: "x", start: false });
    expect(textOf(r)).toMatch(/^Created c\d+ in Backlog: /);
    expect(start).not.toHaveBeenCalled();
  });
});

describe("boardMcpServer (copilot)", () => {
  it("registers the full set of board tools for the copilot", () => {
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const names = ["list_cards", "read_thread", "create_card", "set_tags", "start_card", "send_message", "move_card", "stop_card", "setup_status", "answer_permission", ...CRON_TOOL_NAMES];
    expect(captures.map((t) => t.name)).toEqual(names);
  });

  it("exposes the copilot prompt with the board-tool description", () => {
    expect(COPILOT_PROMPT).toContain("Weft copilot");
    expect(COPILOT_PROMPT).toContain("mcp__board__*");
  });

  it("read_thread formats a thread and reports when it's empty", async () => {
    cardStore.set("c1", card({ id: "c1", title: "T" }));
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const empty = await capturedTool("read_thread").handler({ card_id: "c1", last: 10 });
    expect(textOf(empty)).toContain("(empty thread)");

    threadStore.set("c1", [
      { kind: "user", text: "hi", at: 0 },
      { kind: "assistant", text: "hello", at: 0 },
      { kind: "tool", id: "t1", name: "Bash", summary: "ls", at: 0, isError: false },
      { kind: "tool", id: "t2", name: "Bash", summary: "rm -rf /", at: 0, isError: true },
      { kind: "permission", id: "p1", toolName: "Bash", title: "run ls", at: 0 },
      { kind: "permission", id: "p2", toolName: "Bash", title: "run rm", at: 0, decision: "deny" },
      { kind: "result", text: "ok", at: 0, isError: false },
      { kind: "result", text: "boom", at: 0, isError: true },
    ] as ThreadItem[]);
    const r = await capturedTool("read_thread").handler({ card_id: "c1", last: 10 });
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
    cardStore.set("c1", card({ id: "c1" }));
    threadStore.set("c1", [
      { kind: "user", text: "1", at: 0 },
      { kind: "user", text: "2", at: 0 },
      { kind: "user", text: "3", at: 0 },
      { kind: "user", text: "4", at: 0 },
    ] as ThreadItem[]);
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const r = await capturedTool("read_thread").handler({ card_id: "c1", last: 2 });
    const text = textOf(r);
    expect(text).toContain("USER: 3");
    expect(text).toContain("USER: 4");
    expect(text).not.toContain("USER: 1");
    expect(text).not.toContain("USER: 2");
  });

  it("read_thread defaults to the last 30 items when last is omitted", async () => {
    cardStore.set("c1", card({ id: "c1" }));
    threadStore.set(
      "c1",
      Array.from({ length: 35 }, (_, i) => ({ kind: "user", text: `m${i}`, at: 0 })),
    );
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const r = await capturedTool("read_thread").handler({ card_id: "c1" });
    const text = textOf(r);
    expect(text).toContain("m5"); // index 5 of the kept 30
    expect(text).toContain("m34");
    expect(text).not.toContain("m4");
  });

  it("read_thread refuses the copilot's own card and any unknown id", async () => {
    cardStore.set("copilot", { ...card({ id: "copilot" }), role: "copilot" });
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const r = await capturedTool("read_thread").handler({ card_id: "copilot" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("No card copilot");

    const r2 = await capturedTool("read_thread").handler({ card_id: "missing" });
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).toContain("No card missing");
  });

  it("create_card lets the copilot pick the cli and overrides permission mode only when given", async () => {
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    await capturedTool("create_card").handler({ prompt: "X", folder: testRoot, cli: "puku" });
    expect(nth(created, 0, "created card").input).toMatchObject({ backend: "puku", permissionMode: "auto", cwd: testRoot });

    await capturedTool("create_card").handler({ prompt: "Y", folder: testRoot, permission_mode: "acceptEdits" });
    expect(nth(created, 1, "created card").input).toMatchObject({ permissionMode: "acceptEdits" });
  });

  it("create_card tags the card as the user's, and adds new tags to the catalog", async () => {
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    await capturedTool("create_card").handler({ prompt: "X", folder: testRoot, tags: ["#Bug", "bug", " "] });
    expect(nth(created, 0, "created card").input).toMatchObject({ tags: ["bug"], tagsBy: "user" });
    expect(remembered).toEqual([["bug"]]);
    // No tags, or only blank ones: nothing about tags on the card.
    await capturedTool("create_card").handler({ prompt: "Y", folder: testRoot, tags: [" "] });
    expect(nth(created, 1, "created card").input).not.toHaveProperty("tags");
  });

  it("set_tags replaces a card's tags, or clears them, and refuses the copilot's own card", async () => {
    cardStore.set("a", card({ id: "a", title: "A", tags: ["old"], tagsBy: "auto" }));
    cardStore.set("copilot", card({ id: "copilot", role: "copilot" }));
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    expect(textOf(await capturedTool("set_tags").handler({ card_id: "a", tags: ["UI", "launch"] }))).toBe("Tagged “A”: ui, launch.");
    expect(cardStore.get("a")).toMatchObject({ tags: ["ui", "launch"], tagsBy: "user" });
    expect(textOf(await capturedTool("set_tags").handler({ card_id: "a", tags: [] }))).toBe("Cleared “A”'s tags.");
    expect(cardStore.get("a")?.tags).toEqual([]);
    expect((await capturedTool("set_tags").handler({ card_id: "copilot", tags: ["x"] })).isError).toBe(true);
  });

  it("start_card moves from Backlog to Running via the first message and refuses other columns", async () => {
    cardStore.set("a", card({ id: "a", column: "backlog", prompt: "Do it" }));
    const start = vi.fn();
    boardMcpServer({ start, stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const r = await capturedTool("start_card").handler({ card_id: "a" });
    expect(textOf(r)).toBe("Started “Fix the bug”.");
    expect(start).toHaveBeenCalledWith("a", "Do it");

    cardStore.set("b", card({ id: "b", column: "review" }));
    const r2 = await capturedTool("start_card").handler({ card_id: "b" });
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).toContain("not Backlog");
  });

  it("send_message calls actions.start with the text and the card's id", async () => {
    cardStore.set("a", card({ id: "a" }));
    const start = vi.fn();
    boardMcpServer({ start, stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const r = await capturedTool("send_message").handler({ card_id: "a", text: "continue" });
    expect(textOf(r)).toBe("Sent to “Fix the bug”.");
    expect(start).toHaveBeenCalledWith("a", "continue");
  });

  it("move_card calls updateCard and refuses to move a busy card", async () => {
    cardStore.set("a", card({ id: "a", column: "review" }));
    let busy = false;
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => busy });
    const r = await capturedTool("move_card").handler({ card_id: "a", column: "done" });
    expect(textOf(r)).toBe("Moved “Fix the bug” to done.");
    expect(cardStore.get("a")!.column).toBe("done");
    expect(updated.some((u) => u.id === "a" && u.patch.column === "done")).toBe(true);

    busy = true;
    const r2 = await capturedTool("move_card").handler({ card_id: "a", column: "backlog" });
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).toContain("is running");
  });

  it("stop_card calls actions.stop and returns a confirmation", async () => {
    cardStore.set("a", card({ id: "a" }));
    const stop = vi.fn().mockResolvedValue(undefined);
    boardMcpServer({ start: vi.fn(), stop, answer: vi.fn(), isBusy: () => false });
    const r = await capturedTool("stop_card").handler({ card_id: "a" });
    expect(textOf(r)).toBe("Stopped “Fix the bug”.");
    expect(stop).toHaveBeenCalledWith("a");
  });

  it("answer_permission routes to actions.answer with the right args, building answers from a question", async () => {
    const questions: Question[] = [{ question: "color?", options: [{ label: "red" }] }];
    const pending: PendingPermission = { id: "p1", toolName: "AskUserQuestion", title: "q", input: {}, questions };
    cardStore.set("a", card({ id: "a", pending }));
    const answer = vi.fn();
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer, isBusy: () => false });
    const r = await capturedTool("answer_permission").handler({ card_id: "a", allow: true, answer: "red" });
    expect(textOf(r)).toBe("Allowed on “Fix the bug”.");
    expect(answer).toHaveBeenCalledWith("a", true, { "color?": "red" });

    const r2 = await capturedTool("answer_permission").handler({ card_id: "a", allow: false });
    expect(textOf(r2)).toBe("Denied on “Fix the bug”.");
    expect(answer.mock.calls[1]).toEqual(["a", false, undefined]);
  });
});

describe("createBoardCard ↔ tool handler integration", () => {
  it("the thread tool's create_card calls createBoardCard and then actions.start with the prompt", async () => {
    cardStore.set("parent-1", card({ id: "parent-1", cwd: testRoot, permissionMode: "default" }));
    const start = vi.fn();
    weftMcpServer(() => "parent-1", { start });
    await capturedTool("create_card").handler({ prompt: "Hi" });
    expect(nth(created, 0, "created card").input).toMatchObject({ prompt: "Hi", cwd: testRoot, parentId: "parent-1" });
    expect(start).toHaveBeenCalledWith(nth(created, 0, "created card").out.id, "Hi");
  });
});

describe("read_thread card header", () => {
  it("lists the card's stage, latest line and what it waits on before the thread", async () => {
    cardStore.set(
      "c1",
      card({ id: "c1", column: "needs_you", stage: "First shot", lastLine: "Which db?", pending: { id: "p", toolName: "Bash", title: "Run npm test", input: {} } }),
    );
    boardMcpServer({ start: vi.fn(), stop: async () => {}, answer: vi.fn(), isBusy: () => false });
    const text = textOf(await capturedTool("read_thread").handler({ card_id: "c1" }));
    const header = nth(text.split("\n\n---\n\n"), 0, "section").split("\n");
    expect(header).toEqual(expect.arrayContaining(["stage: First shot", "latest: Which db?", "waiting on the user for: Run npm test"]));
  });
});
