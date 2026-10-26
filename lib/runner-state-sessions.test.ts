// @vitest-environment node
// The rest of lib/runner-state.ts: the shared session maps and the small helpers around them (is a card
// busy, which cards are, what an error says), the inbox's own rules, and the idle-CLI housekeeping that
// closes the least recently used CLIs past the cap.
//
// The session maps are global singletons, so this file resets them between tests. The CLI itself is never
// started: these tests only exercise the bookkeeping around it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const h = vi.hoisted(() => ({
  cards: new Map<string, Card>(),
  // The cards with tasks running in their CLI's process group.
  liveTasks: new Set<string>(),
  keepAlive: 0,
  projects: [] as Array<{ path: string }>,
}));

vi.mock("./store", () => ({
  DATA_DIR: "/nonexistent-weft-test-data",
  getCard: (id: string) => h.cards.get(id),
  listCards: () => [...h.cards.values()],
  updateCard: (id: string, patch: Partial<Card>) => Object.assign(h.cards.get(id)!, patch),
}));
vi.mock("./settings", () => ({
  allowedFolders: () => [] as string[],
  gooseBaseUrl: () => "",
  gooseModelId: () => "",
  gooseProviderId: () => "",
  keepAliveMinutes: () => h.keepAlive,
}));
vi.mock("./task-ledger", () => ({ hasLiveTasks: (id: string) => h.liveTasks.has(id) }));
vi.mock("./skill-sets", () => ({ offFor: () => [] as string[] }));

const state = await import("./runner-state");

const { Inbox, busyCards, close, errorText, isBusy, safeUpdate, scheduleIdle, sessions, spares } = state;

/** A session with the parts the idle housekeeping reads. */
function makeSession(id: string, over: Partial<import("./runner-state").Session> = {}): import("./runner-state").Session {
  const session = {
    build: "b1",
    cardId: id,
    spec: { cwd: "/repo", backend: "claude", permissionMode: "default", copilot: false },
    inbox: new Inbox(),
    abort: new AbortController(),
    busy: false,
    stopping: false,
    pending: [],
    toolIndex: new Map<string, number>(),
    done: Promise.resolve(),
    ...over,
  } as unknown as import("./runner-state").Session;
  sessions.set(id, session);
  return session;
}

beforeEach(() => {
  sessions.clear();
  spares.clear();
  h.cards.clear();
  h.liveTasks.clear();
  h.keepAlive = 0;
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the inbox", () => {
  it("refuses a message once it is closed", () => {
    const inbox = new Inbox();
    inbox.close();
    expect(() => inbox.push("hello")).toThrow(/closing/);
  });

  it("hands the messages over in the order they were pushed", async () => {
    const inbox = new Inbox();
    inbox.push("one");
    inbox.push("two");
    inbox.close();
    const got: string[] = [];
    for await (const m of inbox) {
      got.push((m.message.content as string) || "");
    }
    expect(got).toEqual(["one", "two"]);
  });
});

describe("isBusy", () => {
  it("is true for a card with a turn running, and false for everything else", () => {
    makeSession("a", { busy: true });
    makeSession("b", { busy: false });
    expect(isBusy("a")).toBe(true);
    expect(isBusy("b")).toBe(false);
    expect(isBusy("missing")).toBe(false);
  });
});

describe("busyCards", () => {
  it("names the cards whose turn is running now", () => {
    makeSession("a", { busy: true });
    makeSession("b", { busy: false });
    makeSession("c", { busy: true });
    expect(busyCards()).toEqual(["a", "c"]);
  });
});

describe("safeUpdate", () => {
  it("writes to a card that is there, and leaves a card that is gone alone", () => {
    const card = { id: "a", title: "A", touchedFiles: [] } as unknown as Card;
    h.cards.set("a", card);
    safeUpdate("a", { title: "B" });
    expect(h.cards.get("a")?.title).toBe("B");
    expect(() => safeUpdate("gone", { title: "X" })).not.toThrow();
  });
});

describe("errorText", () => {
  it("is the message of an Error, and the text of anything else", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("plain")).toBe("plain");
  });
});

describe("close", () => {
  it("ends the inbox and aborts the CLI", () => {
    const session = makeSession("a");
    close(session);
    expect(session.abort.signal.aborted).toBe(true);
    expect(() => session.inbox.push("hello")).toThrow(/closing/);
  });
});

describe("the idle CLIs", () => {
  it("closes the least recently used idle CLIs past the cap", () => {
    vi.useFakeTimers();
    const closed: string[] = [];
    for (let i = 0; i < 10; i++) {
      const session = makeSession(`c${i}`);
      session.lastUsed = 1000 + i;
      session.inbox.close = () => closed.push(`c${i}`);
    }
    // The cap is eight, so the two oldest close. The session that asks for the trim is the newest,
    // so it doesn't move itself to the front of the queue.
    scheduleIdle(sessions.get("c9")!);
    expect(closed).toEqual(["c0", "c1"]);
  });

  it("never closes a busy CLI or the copilot's, however old they are", () => {
    vi.useFakeTimers();
    const closed: string[] = [];
    for (let i = 0; i < 12; i++) {
      const session = makeSession(`c${i}`, {
        busy: i === 0,
        spec: { cwd: "/repo", backend: "claude", permissionMode: "default", copilot: i === 1 },
      });
      session.lastUsed = 1000 + i;
      session.inbox.close = () => closed.push(`c${i}`);
    }
    scheduleIdle(sessions.get("c11")!);
    // The two oldest idle CLIs close; the busy one and the copilot's are left alone.
    expect(closed).toEqual(["c2", "c3"]);
  });

  it("closes nothing when keep-alive is off", () => {
    vi.useFakeTimers();
    h.keepAlive = 0;
    const session = makeSession("a");
    let closed = false;
    session.inbox.close = () => {
      closed = true;
    };
    scheduleIdle(session);
    expect(closed).toBe(false);
    expect(session.idle).toBeUndefined();
  });

  it("ends a CLI that won't stop on its own", () => {
    vi.useFakeTimers();
    h.keepAlive = 5;
    const session = makeSession("a");
    scheduleIdle(session);
    // The CLI is closed after the keep-alive time, and aborted ten seconds later if it hasn't gone.
    expect(session.abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(5 * 60_000);
    expect(sessions.has("a")).toBe(false);
    expect(session.abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(session.abort.signal.aborted).toBe(true);
  });

  it("leaves a CLI alone while a task of its own is still running", () => {
    vi.useFakeTimers();
    h.keepAlive = 5;
    const session = makeSession("a");
    h.liveTasks.add("a");
    scheduleIdle(session);
    vi.advanceTimersByTime(5 * 60_000);
    // The CLI is still there: closing it would end the task running in its process group.
    expect(sessions.has("a")).toBe(true);
    // It is asked again later instead.
    expect(session.idle).toBeDefined();
  });

  it("leaves a session that is no longer the card's alone", () => {
    vi.useFakeTimers();
    h.keepAlive = 5;
    const session = makeSession("a");
    // The card's session is replaced while the old one waits to close: the old one must not close the new.
    const replacement = makeSession("a");
    let closed = false;
    session.inbox.close = () => {
      closed = true;
    };
    scheduleIdle(session);
    vi.advanceTimersByTime(5 * 60_000);
    expect(closed).toBe(false);
    expect(sessions.get("a")).toBe(replacement);
  });

  it("leaves a busy session alone", () => {
    vi.useFakeTimers();
    h.keepAlive = 5;
    const session = makeSession("a", { busy: true });
    let closed = false;
    session.inbox.close = () => {
      closed = true;
    };
    scheduleIdle(session);
    vi.advanceTimersByTime(5 * 60_000);
    expect(closed).toBe(false);
    expect(sessions.has("a")).toBe(true);
  });

  it("puts a session that was never used at the back of the queue", () => {
    vi.useFakeTimers();
    const closed: string[] = [];
    // A session with no lastUsed is the oldest there is: it has been around longest without a turn.
    const never = makeSession("never");
    never.lastUsed = undefined;
    never.inbox.close = () => closed.push("never");
    const never2 = makeSession("never2");
    never2.lastUsed = undefined;
    never2.inbox.close = () => closed.push("never2");
    for (let i = 0; i < 9; i++) {
      const session = makeSession(`c${i}`);
      session.lastUsed = 1000 + i;
      session.inbox.close = () => closed.push(`c${i}`);
    }
    scheduleIdle(sessions.get("c8")!);
    expect(closed).toEqual(["never", "never2", "c0"]);
  });
});

describe("the spec of an isolated card", () => {
  it("names the project folder the worktree came from", () => {
    const card = {
      id: "a",
      title: "T",
      prompt: "",
      cwd: "/repo",
      backend: "claude",
      permissionMode: "default",
      column: "backlog",
      createdAt: 0,
      updatedAt: 0,
      worktree: { path: "/repo/.weft/wt-1" },
    } as unknown as Card;
    const spec = state.specFor(card);
    expect(spec.cwd).toBe("/repo/.weft/wt-1");
    expect(spec.project).toBe("/repo");
  });
});
