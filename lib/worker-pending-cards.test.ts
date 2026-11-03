import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";
import { dropPending, drawPending, matchByPrompt, PENDING_MS, pendingCard, pendingSnapshot, settlePending, subscribePending, withPending } from "./worker-pending-cards";

const CWD = "worker://w1/app";
const input = { prompt: "  # Fix the login\nand the rest ", cwd: CWD, backend: "claude" as const, start: true };
const card = (over: Partial<Card> = {}) => ({ id: "real", cwd: CWD, prompt: "Fix the login", createdAt: 1_000, ...over }) as Card;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const c of pendingSnapshot()) dropPending(c.id);
  vi.useRealTimers();
});

describe("pendingCard", () => {
  it("draws the card from what the dialog sent, running or in Backlog", () => {
    const c = pendingCard("p1", { ...input, model: "opus", effort: "high", tags: ["bug"], agent: "builder", isolated: true }, "m1mini", 5);
    expect(c).toMatchObject({ id: "p1", title: "Fix the login", prompt: "# Fix the login\nand the rest", cwd: CWD, column: "running", lastLine: "Sending to m1mini…", model: "opus", effort: "high", tags: ["bug"], agent: "builder", isolated: true, permissionMode: "auto", createdAt: 5 });
    expect(pendingCard("p2", { ...input, start: false, title: "Mine", permissionMode: "default" }, "w")).toMatchObject({ column: "backlog", title: "Mine", permissionMode: "default" });
    expect(pendingCard("p3", input, "w")).not.toHaveProperty("model");
  });
});

describe("the pending store", () => {
  it("draws a pending card until the worker's card with its id comes", () => {
    const heard = vi.fn();
    const off = subscribePending(heard);
    drawPending(pendingCard("p1", input, "w", 1_000));
    expect(heard).toHaveBeenCalledTimes(1);
    const drawn = pendingSnapshot();
    expect(withPending([card()], drawn).map((c) => c.id)).toEqual(["p1", "real"]);
    // The read has it: drawn once, and settled.
    expect(withPending([card({ id: "p1" })], drawn).map((c) => c.id)).toEqual(["p1"]);
    settlePending([card()]);
    expect(pendingSnapshot()).toHaveLength(1);
    settlePending([card({ id: "p1" })]);
    expect(pendingSnapshot()).toEqual([]);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  it("matches a run's card, which the worker names, by its project and first line", () => {
    const heard = vi.fn();
    const off = subscribePending(heard);
    drawPending(pendingCard("p1", input, "w", 1_000));
    matchByPrompt("p1");
    matchByPrompt("p1");
    matchByPrompt("gone");
    // Drawn, then redrawn once to look for it by prompt.
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    drawPending(pendingCard("p2", input, "w", 1_000), true);
    expect(withPending([card({ prompt: "# Fix the login" })]).map((c) => c.id)).toEqual(["real"]);
    expect(withPending([card({ prompt: "Other" })]).map((c) => c.id)).toEqual(["p1", "p2", "real"]);
    dropPending("p2");
    const drawn = pendingSnapshot();
    expect(withPending([card({ prompt: "# Fix the login\nmore", cwd: "worker://w1/other" })], drawn)).toHaveLength(2);
    expect(withPending([card({ prompt: "# Fix the login", createdAt: 1_000 - PENDING_MS - 1 })], drawn)).toHaveLength(2);
    expect(withPending([card({ prompt: "Fix the login" })], drawn).map((c) => c.id)).toEqual(["p1", "real"]);
    // Files pasted with it add to the rest of the prompt on the way.
    expect(withPending([card({ prompt: "# Fix the login\nwith files" })], drawn).map((c) => c.id)).toEqual(["real"]);
    expect(withPending([card({ prompt: undefined })], drawn)).toHaveLength(2);
  });

  it("goes by itself when the worker never publishes it, and a redraw restarts the clock", () => {
    drawPending(pendingCard("p1", input, "w"));
    vi.advanceTimersByTime(PENDING_MS - 1);
    drawPending(pendingCard("p1", input, "w"));
    vi.advanceTimersByTime(PENDING_MS - 1);
    expect(pendingSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(pendingSnapshot()).toEqual([]);
  });

  it("drops one on a refusal, and an unknown id is a no-op", () => {
    const heard = vi.fn();
    const off = subscribePending(heard);
    dropPending("nope");
    expect(heard).not.toHaveBeenCalled();
    drawPending(pendingCard("p1", input, "w"));
    dropPending("p1");
    expect(pendingSnapshot()).toEqual([]);
    expect(withPending([card()])).toEqual([card()]);
    off();
  });
});
