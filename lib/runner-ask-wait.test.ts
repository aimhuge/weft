import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pending, Session } from "./runner-state";
import type { Card } from "./types";

// A symbol clash (lib/claims.ts) waits by itself: the card goes to Running and waits, never to
// Needs you. Every other prompt — the card's permission mode, an outside folder, a question —
// still parks in Needs you, because those really need the user.

const cards = new Map<string, Card>();
const sessions = new Map<string, Session>();
const safeUpdate = vi.fn();
const appendThread = vi.fn((_cardId: string, item: { kind: string }) => ({ ...item, index: 0 }));
const startWaiting = vi.fn((cardId: string, p: Pending) => {
  p.waiting = true;
  safeUpdate(cardId, { column: "running", pending: { id: p.id, waiting: true }, lastLine: `Waiting for ‘${p.why?.holder?.title}’` });
});
const watchHolds = vi.fn();

vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  appendThread: (...args: Parameters<typeof appendThread>) => appendThread(...args),
  getCard: (id: string) => cards.get(id),
  replaceThreadItem: vi.fn(),
}));
vi.mock("./runner-state", () => ({ sessions, safeUpdate }));
vi.mock("./permission-wait", () => ({ startWaiting, watchHolds }));

const { askUser } = await import("./runner-ask");

const holder = { id: "h", title: "Fix login", claim: "/repo/a.ts#one" };

function session(cardId = "me") {
  const s = { pending: [], spec: { cwd: "/repo", permissionMode: "default" }, busy: true } as unknown as Session;
  sessions.set(cardId, s);
  return s;
}

function clashWhy() {
  return { category: "same-code" as const, detail: "‘Fix login’ (running) has uncommitted edits to one", holder };
}

beforeEach(() => {
  cards.clear();
  sessions.clear();
  safeUpdate.mockClear();
  startWaiting.mockClear();
  watchHolds.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe("askUser with a symbol clash", () => {
  it("waits by itself instead of parking the card in Needs you", async () => {
    const s = session();
    const signal = new AbortController().signal;
    const promise = askUser("me", s, "Edit", { file_path: "/repo/a.ts" }, signal, "Card ‘Fix login’ is editing one. Wait, or go ahead?", {
      symbols: ["one"],
      why: clashWhy(),
    });
    expect(startWaiting).toHaveBeenCalledWith("me", expect.objectContaining({ id: expect.any(String) as unknown }));
    expect(watchHolds).toHaveBeenCalled();
    expect(safeUpdate).not.toHaveBeenCalledWith("me", expect.objectContaining({ column: "needs_you" }));
    // The request is still open, so the thread waits for the user to go ahead or deny it.
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]!.waiting).toBe(true);
    s.pending[0]!.resolve({ behavior: "deny", message: "Cancelled." });
    await promise;
  });

  it("still parks in Needs you for the card's own permission mode", async () => {
    const s = session();
    const signal = new AbortController().signal;
    const promise = askUser("me", s, "Bash", { command: "npm test" }, signal, "Run npm test", {});
    expect(startWaiting).not.toHaveBeenCalled();
    expect(safeUpdate).toHaveBeenCalledWith("me", expect.objectContaining({ column: "needs_you" }));
    s.pending[0]!.resolve({ behavior: "deny", message: "Cancelled." });
    await promise;
  });

  it("still parks in Needs you for a question", async () => {
    const s = session();
    const signal = new AbortController().signal;
    const promise = askUser(
      "me",
      s,
      "AskUserQuestion",
      { questions: [{ question: "Which db?", options: [{ label: "A" }] }] },
      signal,
    );
    expect(startWaiting).not.toHaveBeenCalled();
    expect(safeUpdate).toHaveBeenCalledWith("me", expect.objectContaining({ column: "needs_you" }));
    s.pending[0]!.resolve({ behavior: "deny", message: "Cancelled." });
    await promise;
  });
});
