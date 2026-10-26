// Shared fakes for the board-tools tests (lib/board-tools.test.ts and lib/board-tools-copilot.test.ts):
// the SDK MCP server is stubbed so every registered tool can be called directly, and the store, the
// tag catalog, the settings and the folders are fakes. The test file creates the state with
// vi.hoisted and mounts the mocks through the factories below.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import type { Card, ThreadItem } from "./types";

// A tool the SDK MCP server registers: the handler takes the tool's arguments and answers the way
// MCP does. The board wraps the result in attempt() (board-tools.ts), so an error comes back as
// isError: true with the message as text.
export interface CapturedTool {
  name: string;
  description: string;
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[]; isError?: true }>;
}

// Everything the fakes record. The test file holds one of these and hands it to the mocks.
export function boardState() {
  return {
    // Every tool registered since the last reset, in order.
    captures: [] as CapturedTool[],
    // The in-memory store: the cards that exist, the threads, and what was created or updated.
    cardStore: new Map<string, Card>(),
    threadStore: new Map<string, ThreadItem[]>(),
    created: [] as { input: Record<string, unknown>; out: Card }[],
    updated: [] as { id: string; patch: Partial<Card> }[],
    // The tag catalog (lib/tag-store.ts) writes ~/.weft/tags.json; here it records what joined it.
    remembered: [] as string[][],
    // The folders the settings were told about (lib/settings touchProject).
    touched: [] as string[],
    // The setup report (lib/copilot-setup.ts) and the projects it defaults to (lib/copilot-sources.ts).
    setupReport: vi.fn(),
    activeProjects: vi.fn<(cards: unknown[]) => string[]>(() => []),
    // A real directory for the tests that need one (folders.resolveFolder requires it to exist).
    testRoot: "",
  };
}

export type State = ReturnType<typeof boardState>;

// The mock of @anthropic-ai/claude-agent-sdk: every tool the server registers is captured, so a
// test can call its handler directly.
export function sdkMock(state: State) {
  return {
    createSdkMcpServer: (options: { tools?: CapturedTool[] }) => {
      for (const t of options.tools ?? []) state.captures.push(t);
      return { name: "board" };
    },
    // tool() returns an SdkMcpToolDefinition; tests just need its handler and metadata.
    tool: (name: string, description: string, _schema: unknown, handler: CapturedTool["handler"]) => ({
      name,
      description,
      handler,
    }),
  };
}

// The mock of lib/store.ts: an in-memory board.
export function storeMock(state: State) {
  return {
    // The cron tools (lib/cron-tools.ts) reach modules that read the data folder as they load.
    DATA_DIR: "/tmp/weft-board-tools-test",
    createCard: (input: Record<string, unknown>) => {
      const card: Card = {
        id: `c${state.created.length + 1}`,
        column: "backlog",
        createdAt: 1,
        updatedAt: 1,
        ...input,
      } as Card;
      state.created.push({ input, out: card });
      state.cardStore.set(card.id, card);
      return card;
    },
    getCard: (id: string) => state.cardStore.get(id),
    getThread: (id: string) => state.threadStore.get(id) ?? [],
    listCards: () => [...state.cardStore.values()],
    updateCard: (id: string, patch: Partial<Card>) => {
      const card = state.cardStore.get(id);
      if (!card) throw new Error(`No card ${id}`);
      Object.assign(card, patch, { updatedAt: Date.now() });
      state.updated.push({ id, patch });
      return card;
    },
    appendThread: (id: string, item: ThreadItem) => {
      const list = state.threadStore.get(id) ?? [];
      list.push(item);
      state.threadStore.set(id, list);
      return list.length - 1;
    },
    replaceThreadItem: (id: string, index: number, item: ThreadItem) => {
      const list = state.threadStore.get(id) ?? [];
      list[index] = item;
      state.threadStore.set(id, list);
    },
  };
}

// The mock of lib/settings.ts.
export function settingsMock(state: State) {
  return {
    touchProject: (folder: string) => state.touched.push(folder),
    defaultPermissionMode: () => "auto",
    // firstMessage() in the create_card / start_card handlers reads automations(); returning []
    // keeps the first message equal to the prompt.
    automations: () => [],
  };
}

// The mock of lib/folders.ts. resolveFolder() requires an existing directory, so the real one is
// short enough to mirror and the tests point it at a per-test temp dir.
export function foldersMock() {
  return {
    resolveFolder: (raw: unknown) => {
      const text = typeof raw === "string" ? raw.trim() : "";
      const folder = text || ".";
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`${folder} isn't a folder.`);
      return folder;
    },
  };
}

// The mock of lib/tag-store.ts.
export function tagStoreMock(state: State) {
  return { rememberTags: (tags: string[]) => state.remembered.push(tags) };
}

// The mock of lib/copilot-setup.ts.
export function copilotSetupMock(state: State) {
  return { setupReport: state.setupReport };
}

// The mock of lib/copilot-sources.ts.
export function copilotSourcesMock(state: State) {
  return { activeProjects: state.activeProjects };
}

// The item at index i; throws a clear error when it doesn't exist.
export function nth<T>(arr: readonly T[], i: number, what = "item"): T {
  const item = arr[i];
  if (item === undefined) throw new Error(`No ${what} at index ${String(i)} (have ${String(arr.length)})`);
  return item;
}

// The text of a tool result's first content block.
export const textOf = (r: Awaited<ReturnType<CapturedTool["handler"]>>) => nth(r.content, 0, "content block").text;

// The tool of that name. Multiple servers register the same tool name (list_cards, create_card);
// the 'after' argument picks the nth match: 0 for the first, 1 for the second.
export function capturedTool(state: State, name: string, after = 0) {
  const matches = state.captures.filter((x) => x.name === name);
  const t = matches[after];
  if (!t) throw new Error(`No tool ${name} (after ${after}) captured. Captured: ${state.captures.map((x) => x.name).join(", ")}`);
  return t;
}

// A card fixture: the fields the board tools read.
export const card = (state: State, over: Partial<Card> = {}): Card =>
  ({
    id: "c1",
    title: "Fix the bug",
    prompt: "Fix the bug",
    cwd: state.testRoot,
    backend: "claude",
    permissionMode: "default" as const,
    column: "backlog" as const,
    createdAt: 0,
    updatedAt: 0,
    promptSkills: [],
    ...over,
  });

// The fake actions a board server is given, all of them spies.
export const fakeActions = () => ({
  start: vi.fn(),
  stop: vi.fn(() => Promise.resolve()),
  answer: vi.fn(),
  isBusy: () => false,
});

// The state every test file starts from. Each test gets its own real directory, so the
// createBoardCard path can be exercised end-to-end against the real folders.resolveFolder (only
// the "missing dir" test deliberately points at a path that doesn't exist).
export function reset(state: State) {
  state.cardStore.clear();
  state.threadStore.clear();
  state.created.length = 0;
  state.updated.length = 0;
  state.touched.length = 0;
  state.captures.length = 0;
  state.remembered.length = 0;
  state.setupReport.mockReset();
  state.activeProjects.mockReset();
  state.activeProjects.mockReturnValue([]);
  state.testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weft-board-tools-"));
}
