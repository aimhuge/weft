import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent, Card } from "./types";

const cards = new Map<string, Card>();
const busy = new Set<string>();
const queued = new Map<string, string[]>();
const events: BoardEvent[] = [];
const listeners = new Set<(event: BoardEvent) => void>();
const shell = vi.fn<(route: string, body?: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve({ ok: true }));

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => Object.assign(cards.get(id)!, patch),
}));
vi.mock("./runner-state", () => ({ busyCards: () => [...busy], queued }));
vi.mock("./browser-tools", () => ({ shell: (route: string, body?: Record<string, unknown>) => shell(route, body) }));
vi.mock("./bus", () => ({
  publish: (event: BoardEvent) => events.push(event),
  subscribe: (listener: (event: BoardEvent) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

const { armRestart, cancelRestart, COPILOT_HELD, holdForRestart, RERUN_HELD, restartArmed, restartStatus, SETTLE_MS } = await import(
  "./restart-when-idle"
);

const card = (id: string, over: Partial<Card> = {}) =>
  cards.set(id, { id, title: `Card ${id}`, prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over });
// A card changed on the board: what the drain listens for.
const cardEvent = (id: string) => listeners.forEach((l) => l({ type: "card", card: cards.get(id)! }));
const lastRestart = () => events.flatMap((e) => (e.type === "restart" ? [e.restart] : [])).at(-1);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WEFT_SHELL_URL", "http://127.0.0.1:9");
  cards.clear();
  busy.clear();
  queued.clear();
  events.length = 0;
  shell.mockClear();
});

afterEach(() => {
  cancelRestart();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("armRestart", () => {
  it("needs the desktop app", () => {
    vi.stubEnv("WEFT_SHELL_URL", "");
    expect(() => armRestart()).toThrow(/desktop app/);
    expect(restartArmed()).toBe(false);
  });

  it("waits for running and queued turns, then asks Electron to relaunch", async () => {
    card("a");
    card("b");
    busy.add("a");
    queued.set("b", ["/weft:done"]);
    expect(armRestart()).toEqual({
      armed: true,
      then: "relaunch",
      waiting: [
        { id: "a", title: "Card a" },
        { id: "b", title: "Card b" },
      ],
    });
    expect(lastRestart()?.waiting).toHaveLength(2);

    busy.delete("a");
    cardEvent("a");
    expect(lastRestart()?.waiting).toEqual([{ id: "b", title: "Card b" }]);
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(shell).not.toHaveBeenCalled();

    queued.delete("b");
    cardEvent("b");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(shell).toHaveBeenCalledWith("/app/restart", { then: "relaunch" });
    // Still armed while Electron quits, so nothing starts meanwhile.
    expect(restartArmed()).toBe(true);
  });

  it("doesn't take a gap between two queued turns for idle", async () => {    card("a");
    armRestart();
    // The turn ends, and its queued follow-up starts a tick later.
    busy.add("a");
    cardEvent("a");
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2);
    busy.delete("a");
    cardEvent("a");
    await vi.advanceTimersByTimeAsync(SETTLE_MS / 2);
    busy.add("a");
    cardEvent("a");
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(shell).not.toHaveBeenCalled();
  });

  it("restarts a settle after arming when nothing runs", async () => {
    armRestart();
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(shell).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(shell).toHaveBeenCalledTimes(1);
  });

  it("re-checks when its settle timer fires, in case a turn started without a card event", async () => {
    armRestart();
    busy.add("x");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(shell).not.toHaveBeenCalled();
  });

  it("turns an armed relaunch into an update, never back", async () => {
    busy.add("a");
    card("a");
    expect(armRestart().then).toBe("relaunch");
    expect(armRestart("update").then).toBe("update");
    expect(armRestart("relaunch").then).toBe("update");
    busy.delete("a");
    cardEvent("a");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(shell).toHaveBeenCalledWith("/app/restart", { then: "update" });
  });

  it("publishes only when what it waits on changes", () => {
    card("a");
    busy.add("a");
    armRestart();
    const count = events.length;
    cardEvent("a");
    cardEvent("a");
    expect(events.length).toBe(count);
  });

  it("remembers the card that asked, so the board can mark it", () => {
    card("asker", { title: "The card that asked" });
    expect(armRestart("relaunch", "asker").requestedBy).toEqual({ id: "asker", title: "The card that asked" });
    expect(restartStatus().requestedBy).toEqual({ id: "asker", title: "The card that asked" });
    // It rides the board event stream, so the board marks the card without asking.
    expect(lastRestart()?.requestedBy).toEqual({ id: "asker", title: "The card that asked" });
  });

  it("has no asking card when the restart came from the menu or the palette", () => {
    expect(armRestart().requestedBy).toBeUndefined();
    expect(restartStatus().requestedBy).toBeUndefined();
  });

  it("marks the newest asker when a second card asks while armed", () => {
    card("first", { title: "First" });
    card("second", { title: "Second" });
    armRestart("relaunch", "first");
    expect(armRestart("relaunch", "second").requestedBy).toEqual({ id: "second", title: "Second" });
  });

  it("forgets the asking card once the restart is cancelled", () => {
    card("asker", { title: "The card that asked" });
    armRestart("relaunch", "asker");
    expect(cancelRestart().requestedBy).toBeUndefined();
    expect(restartStatus().requestedBy).toBeUndefined();
  });

  it("calls a card with no title a thread, and keeps the id", () => {
    expect(armRestart("relaunch", "gone").requestedBy).toEqual({ id: "gone", title: "A thread" });
  });

  it("ignores events other than card changes", async () => {
    armRestart();
    busy.add("a");
    card("a");
    listeners.forEach((l) => l({ type: "account" }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    // The timer from arming re-checks and finds a turn running.
    expect(shell).not.toHaveBeenCalled();
  });

  it("disarms and says why when Electron can't restart", async () => {
    shell.mockRejectedValueOnce(new Error("no route"));
    armRestart();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(restartArmed()).toBe(false);
    expect(lastRestart()).toMatchObject({ armed: false, error: "Weft couldn't restart: no route" });
  });

  it("says a non-Error failure too", async () => {
    shell.mockRejectedValueOnce("boom");
    armRestart();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(lastRestart()?.error).toBe("Weft couldn't restart: boom");
  });

  it("leaves a newer arm alone when an older restart fails late", async () => {
    let fail: (err: Error) => void = () => {};
    shell.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    armRestart();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    cancelRestart();
    busy.add("a");
    card("a");
    armRestart();
    fail(new Error("late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(restartArmed()).toBe(true);
  });
});

describe("cancelRestart", () => {
  it("disarms, stops listening and tells the board", async () => {
    card("a");
    busy.add("a");
    armRestart();
    expect(cancelRestart()).toEqual({ armed: false, waiting: [{ id: "a", title: "Card a" }] });
    expect(lastRestart()?.armed).toBe(false);
    expect(listeners.size).toBe(0);
    busy.delete("a");
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(shell).not.toHaveBeenCalled();
  });

  it("is harmless with nothing armed", () => {
    expect(cancelRestart().armed).toBe(false);
  });
});

describe("restartStatus", () => {
  it("names a card that's gone as a thread", () => {
    busy.add("gone");
    expect(restartStatus()).toEqual({ armed: false, waiting: [{ id: "gone", title: "A thread" }] });
  });
});

describe("holdForRestart", () => {
  it("lets messages through with nothing armed", () => {
    card("a");
    expect(holdForRestart("a", "hi")).toBe(false);
    expect(cards.get("a")!.scheduled).toBeUndefined();
  });

  it("keeps a message on its card, due now and first in line", () => {
    card("a", { scheduled: [{ id: "later", text: "later", at: Date.now() + 60_000 }] });
    busy.add("b");
    armRestart();
    expect(holdForRestart("a", "hi")).toBe(true);
    const [held, later] = cards.get("a")!.scheduled!;
    expect(held).toMatchObject({ text: "hi", at: Date.now(), afterRestart: true });
    expect(later?.id).toBe("later");
  });

  it("refuses a re-run, a missing card and the copilot", () => {
    card("a");
    card("copilot", { role: "copilot" });
    busy.add("b");
    armRestart();
    expect(() => holdForRestart("a", "again", { echo: false })).toThrow(RERUN_HELD);
    expect(() => holdForRestart("nope", "hi")).toThrow("No such card.");
    expect(() => holdForRestart("copilot", "hi")).toThrow(COPILOT_HELD);
  });
});

// A drain armed by a server process that has since been replaced. globalSingleton keeps it on globalThis, so a
// respawned `next dev` used to inherit it still-armed and restart Weft again a second after it came up (the
// server.cjs SIGTERM loop, 2026-10-21). Re-importing with fresh modules is exactly that respawn.
describe("a drain inherited from a previous server process", () => {
  it("is disarmed on boot instead of restarting Weft again", async () => {
    vi.resetModules();
    const first = await import("./restart-when-idle");
    first.armRestart();
    expect(first.restartArmed()).toBe(true);
    // No timers run: this is the old process, about to be killed mid-drain.
    vi.useRealTimers();

    vi.resetModules();
    const second = await import("./restart-when-idle");
    expect(second.restartStatus().armed).toBe(false);
    // And it stays disarmed: nothing fires a second restart.
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 5);
    expect(shell).not.toHaveBeenCalled();
  });

  it("keeps a drain this generation armed", async () => {
    vi.resetModules();
    const mod = await import("./restart-when-idle");
    mod.armRestart();
    vi.resetModules();
    // The same module instance (no respawn) still has it armed; only a respawn clears it.
    expect(mod.restartArmed()).toBe(true);
    mod.cancelRestart();
    expect(mod.restartArmed()).toBe(false);
  });
});
