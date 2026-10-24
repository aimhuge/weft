import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pending, Session } from "./runner-state";
import type { Card } from "./types";

const cards = new Map<string, Card>();
const sessions = new Map<string, Session>();
const settle = vi.fn((cardId: string, _allow: boolean, _a: unknown, pendingId: string) => {
  const s = sessions.get(cardId)!;
  s.pending.splice(s.pending.findIndex((p) => p.id === pendingId), 1);
  return true;
});
const safeUpdate = vi.fn();

vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id) }));
vi.mock("./runner-pending", () => ({ settle, pendingView: (p: Pending) => ({ id: p.id, waiting: p.waiting }) }));
vi.mock("./runner-state", () => ({ sessions, safeUpdate }));

const { checkWaits, releasedBecause, startWaiting, waitOverMessage, waitPermission, WAIT_POLL_MS } = await import("./permission-wait");

const holder = { id: "h", title: "Fix login", claim: "/repo/a.ts#one" };

function card(over: Partial<Card> = {}): Card {
  return { id: "h", title: "Fix login", prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0, claims: [holder.claim], ...over };
}

function pending(id: string, over: Partial<Pending> = {}): Pending {
  return { id, index: 0, toolName: "Edit", title: "t", input: { file_path: "/repo/a.ts" }, why: { category: "same-code", detail: "d", holder }, resolve: vi.fn(), ...over };
}

function session(...pending: Pending[]) {
  sessions.set("me", { pending } as unknown as Session);
}

beforeEach(() => {
  vi.useFakeTimers();
  cards.clear();
  sessions.clear();
  settle.mockClear();
  safeUpdate.mockClear();
  checkWaits();
});
afterEach(() => vi.useRealTimers());

describe("releasedBecause", () => {
  it("holds while the holder is busy with its claim, and says why it let go", () => {
    cards.set("h", card());
    expect(releasedBecause(holder)).toBeUndefined();
    cards.set("h", card({ claims: [] }));
    expect(releasedBecause(holder)).toBe("‘Fix login’ committed its change");
    cards.set("h", card({ claims: undefined }));
    expect(releasedBecause(holder)).toBe("‘Fix login’ committed its change");
    cards.set("h", card({ column: "review" }));
    expect(releasedBecause(holder)).toBe("‘Fix login’ finished");
    cards.set("h", card({ archived: true }));
    expect(releasedBecause(holder)).toBe("‘Fix login’ is gone");
    cards.delete("h");
    expect(releasedBecause(holder)).toBe("‘Fix login’ is gone");
  });
});

describe("waitOverMessage", () => {
  it("tells the thread to re-read the file and redo the edit", () => {
    expect(waitOverMessage("‘Fix login’ finished", pending("p"))).toBe(
      "You were held while another card edited the same code; the user chose to wait. ‘Fix login’ finished, so a.ts may have changed. Re-read a.ts and redo this edit on top of its change.",
    );
    expect(waitOverMessage("x", pending("p", { input: {} }))).toContain("so the file may have changed");
  });
});

describe("waitPermission", () => {
  it("holds the request, shows it waiting, and answers it once the holder finishes", () => {
    cards.set("h", card());
    session(pending("p1"));
    waitPermission("me", "p1");
    expect(safeUpdate).toHaveBeenCalledWith("me", { column: "running", pending: { id: "p1", waiting: true }, lastLine: "Waiting for ‘Fix login’" });
    expect(settle).not.toHaveBeenCalled();
    cards.set("h", card({ column: "done" }));
    vi.advanceTimersByTime(WAIT_POLL_MS);
    expect(settle).toHaveBeenCalledWith("me", false, undefined, "p1", undefined, expect.stringContaining("‘Fix login’ finished, so a.ts"));
    // Nothing left waiting: the watch stops.
    settle.mockClear();
    vi.advanceTimersByTime(WAIT_POLL_MS * 3);
    expect(settle).not.toHaveBeenCalled();
  });

  it("answers at once when the holder already let go, and leaves requests that don't wait alone", () => {
    session(pending("other"), pending("p1"));
    waitPermission("me", "p1");
    expect(safeUpdate).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledTimes(1);
    expect(sessions.get("me")!.pending.map((p) => p.id)).toEqual(["other"]);
  });

  it("refuses a request that's gone or that no card is holding", () => {
    expect(() => waitPermission("nobody", "p1")).toThrow("isn't waiting anymore");
    session(pending("p1", { why: { category: "mode", detail: "Ask me asks before Edit" } }));
    expect(() => waitPermission("me", "p2")).toThrow("isn't waiting anymore");
    expect(() => waitPermission("me", "p1")).toThrow("Only an edit another card is holding can wait.");
  });
});

describe("startWaiting", () => {
  it("marks the request waiting and moves the card to Running", () => {
    const p = pending("p1");
    startWaiting("me", p);
    expect(p.waiting).toBe(true);
    expect(safeUpdate).toHaveBeenCalledWith("me", { column: "running", pending: { id: "p1", waiting: true }, lastLine: "Waiting for ‘Fix login’" });
  });

  it("leaves a request nothing holds alone", () => {
    const p = pending("p1", { why: { category: "mode", detail: "Ask me asks before Edit" } });
    startWaiting("me", p);
    expect(p.waiting).toBeUndefined();
    expect(safeUpdate).not.toHaveBeenCalled();
  });
});
