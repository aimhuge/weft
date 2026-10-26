import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// Whose Bash wrote a file (lib/bash-claims.ts + lib/bash-writers.ts). Cards share one tree, and a file a
// command wrote carries only an mtime: one is claimed by a card only when that card's Bash was the only one
// open when it was written, or its line names the file; otherwise its writer is unknown and no card claims
// it. Board data, given times and (mocked) git status, as in lib/bash-claims.test.ts.

const cards = new Map<string, Card>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  listCards: () => [...cards.values()],
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = { ...cards.get(id)!, ...patch };
    cards.set(id, card);
    return card;
  }),
}));

const dirty = { list: [] as string[] };
const writtenAt = vi.fn((files: string[], since: number) => new Map(files.map((f) => [f, since])));
vi.mock("./dirty-files", () => ({ repoRoot: () => root, dirtyFiles: () => dirty.list, writtenAt }));

const { bashClaimHooks } = await import("./bash-claims");
const writers = await import("./bash-writers");

const root = "/weft-tree";
const other = "/elsewhere";
const held = `${root}/lib/held.ts`;
const signal = new AbortController().signal;

function card(id: string, over: Partial<Card> = {}): Card {
  return { id, title: `Card ${id}`, prompt: "", cwd: root, backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, ...over };
}

const pre = (cardId: () => string, command: string, toolUseId: string) =>
  bashClaimHooks(cardId).pre.hooks[0]!({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: root } as never, toolUseId, { signal });

const post = (cardId: () => string, toolUseId: string, tool_input: Record<string, unknown> = { command: "pnpm build" }, response?: unknown) =>
  bashClaimHooks(cardId).post.hooks[0]!({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input, cwd: root, tool_response: response } as never, toolUseId, { signal });

beforeEach(() => {
  cards.clear();
  writers.resetWriters();
  cards.set("me", card("me"));
});

describe("whose Bash wrote a file", () => {
  // The cron card's script and subagents wrote cron files while other cards' commands were running; those
  // cards used to claim them on finishing, and a failed check then told the cron card to leave its own files.
  const crons = `${root}/lib/crons.test.ts`;
  const at = (ms: number) => vi.setSystemTime(ms);
  const writes = (file: string, mtime: number) => writtenAt.mockImplementation((files: string[]) => new Map(files.filter((f) => f === file).map((f) => [f, mtime])));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    cards.set("other", card("other", { title: "Keyboard shortcuts" }));
    dirty.list = [crons];
  });
  afterEach(() => vi.useRealTimers());

  it("leaves a file written while two cards' Bash ran unclaimed by both, and calls its writer unknown", async () => {
    at(1000);
    await pre(() => "other", "pnpm test", "theirs");
    at(1100);
    await pre(() => "me", "node gen.mjs", "mine");
    writes(crons, 1200);
    at(1300);
    await post(() => "other", "theirs", { command: "pnpm test" });
    at(1400);
    await post(() => "me", "mine", { command: "node gen.mjs" });
    expect(cards.get("other")?.claims).toBeUndefined();
    expect(cards.get("me")?.claims).toBeUndefined();
    expect(writers.unknownWriters().has(crons)).toBe(true);
    // The other card still holds a claim elsewhere; the check names that card for its file, crons.test.ts as unknown.
    cards.set("other", card("other", { title: "Keyboard shortcuts", claims: [`${held}#*`] }));
    dirty.list = [crons, held];
    writtenAt.mockImplementation(() => new Map());
    await pre(() => "me", "pnpm vitest run", "check");
    const out = await post(() => "me", "check", { command: "pnpm vitest run" }, "FAIL lib/crons.test.ts > x\nlib/held.ts(1,1): error TS1");
    const note = (out as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(note).toContain("- lib/crons.test.ts: unknown");
    expect(note).toContain("- lib/held.ts: ‘Keyboard shortcuts’");
    expect(note).not.toContain("lib/crons.test.ts: ‘");
  });

  it("gives a file to the card whose Bash ran alone when it was written, not to one that started later", async () => {
    at(1000);
    await pre(() => "me", "node gen.mjs", "mine");
    writes(crons, 1050);
    at(1100);
    await pre(() => "other", "pnpm test", "theirs");
    at(1200);
    await post(() => "other", "theirs", { command: "pnpm test" });
    expect(cards.get("other")?.claims).toBeUndefined();
    at(1300);
    await post(() => "me", "mine", { command: "node gen.mjs" });
    expect(cards.get("me")?.claims).toEqual([`${crons}#*`]);
    expect(writers.unknownWriters().has(crons)).toBe(false);
  });

  it("claims a file the command line names as written even with another card's Bash open", async () => {
    at(1000);
    await pre(() => "other", "pnpm test", "theirs");
    await pre(() => "me", `sed -i '' 's/a/b/' ${crons}`, "sed");
    writes(crons, 1000);
    at(1100);
    await post(() => "me", "sed", { command: `sed -i '' 's/a/b/' ${crons}` });
    expect(cards.get("me")?.claims).toEqual([`${crons}#*`]);
  });

  it("keeps a background call's window open after it returns, so its subagent's writes aren't another card's", async () => {
    at(1000);
    await pre(() => "me", "puku-cli -p 'write cron tests'", "bg");
    writtenAt.mockImplementation(() => new Map());
    at(1010);
    await post(() => "me", "bg", { command: "puku-cli -p x", run_in_background: true });
    at(5000);
    await pre(() => "other", "pnpm lint", "lint");
    writes(crons, 5050);
    at(5100);
    await post(() => "other", "lint", { command: "pnpm lint" });
    expect(cards.get("other")?.claims).toBeUndefined();
    expect(writers.unknownWriters().has(crons)).toBe(true);
    // The same card's next command sees only its own windows around the write, so the file is its own.
    at(6000);
    await pre(() => "me", "ls", "next");
    writes(crons, 6050);
    at(6100);
    await post(() => "me", "next", { command: "ls" });
    expect(cards.get("me")?.claims).toEqual([`${crons}#*`]);
    expect(writers.unknownWriters().has(crons)).toBe(false);
  });

  it("calls a write unknown while a Codex or Goose card, which runs no hooks, is busy in the tree", async () => {
    cards.set("other", card("other", { title: "Codex card", backend: "codex" }));
    at(1000);
    await pre(() => "me", "node gen.mjs", "mine");
    writes(crons, 1050);
    at(1100);
    await post(() => "me", "mine", { command: "node gen.mjs" });
    expect(cards.get("me")?.claims).toBeUndefined();
    expect(writers.unknownWriters().has(crons)).toBe(true);
  });

  it("forgets an unknown writer once the file is clean", async () => {
    writers.markUnknown(crons);
    writers.markUnknown(`${other}/elsewhere.ts`);
    dirty.list = [];
    await post(() => "me", "none");
    expect([...writers.unknownWriters()]).toEqual([`${other}/elsewhere.ts`]);
  });
});
