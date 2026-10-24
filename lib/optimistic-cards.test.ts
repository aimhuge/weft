import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const api = vi.hoisted(() => ({ remove: vi.fn(), stop: vi.fn() }));
vi.mock("./client", () => ({ api }));

import { applyIntents, forget, onOptimistic, overlay, overlayAll, removeNow, STOP_SETTLE_MS, stopNow, type OptimisticUpdate } from "./optimistic-cards";

const card = (over: Partial<Card> = {}): Card => ({ id: "a", title: "A", column: "running", cwd: "/r", ...over }) as Card;

let updates: OptimisticUpdate[];
let off: () => void;
beforeEach(() => {
  updates = [];
  off = onOptimistic((u) => updates.push(u));
  api.remove.mockReset().mockResolvedValue({ ok: true });
  api.stop.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  off();
  for (const id of ["a", "b"]) forget(id);
  vi.useRealTimers();
});

describe("removeNow", () => {
  it("drops the card at once and forgets it once the server agrees", async () => {
    const done = removeNow("a");
    expect(updates).toEqual([{ kind: "apply" }]);
    expect(applyIntents([card(), card({ id: "b" })]).map((c) => c.id)).toEqual(["b"]);
    expect(overlay(card())).toBeNull();
    await done;
    expect(api.remove).toHaveBeenCalledWith("a");
    expect(overlay(card())).toEqual(card());
    expect(updates).toEqual([{ kind: "apply" }]);
  });

  it("reloads and rethrows when the server refuses", async () => {
    api.remove.mockRejectedValueOnce(new Error("copilot"));
    await expect(removeNow("a")).rejects.toThrow("copilot");
    expect(updates).toEqual([{ kind: "apply" }, { kind: "reload" }]);
    expect(overlay(card())).toEqual(card());
  });
});

describe("stopNow", () => {
  it("draws a running card in Review until the server shows it stopped", async () => {
    await stopNow("a");
    expect(applyIntents([card({ pending: { id: "p" } as Card["pending"] })])[0]).toMatchObject({ column: "review", pending: null, lastLine: "Stopped" });
    // Its own copy, already drawn as stopped, doesn't count as the server catching up.
    applyIntents([card({ column: "review" })]);
    expect(overlay(card())?.column).toBe("review");
    // A card waiting on a permission in Needs you keeps its column but loses the question.
    expect(overlay(card({ column: "needs_you", pending: { id: "p" } as Card["pending"] }))).toMatchObject({ column: "needs_you", pending: null });
    const ended = card({ column: "review", lastLine: "Stopped by the CLI" });
    expect(overlay(ended)).toBe(ended);
    expect(overlay(card())).toEqual(card());
  });

  it("gives up and reloads when the card never leaves Running", async () => {
    vi.useFakeTimers();
    await stopNow("a");
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(updates).toEqual([{ kind: "apply" }, { kind: "reload" }]);
    expect(overlay(card())).toEqual(card());
  });

  it("doesn't reload when the card already caught up before the timer", async () => {
    vi.useFakeTimers();
    await stopNow("a");
    overlay(card({ column: "review" }));
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(updates).toEqual([{ kind: "apply" }]);
  });

  it("reloads and rethrows when the server refuses", async () => {
    api.stop.mockRejectedValueOnce(new Error("gone"));
    await expect(stopNow("a")).rejects.toThrow("gone");
    expect(updates).toEqual([{ kind: "apply" }, { kind: "reload" }]);
  });
});

describe("overlayAll / applyIntents", () => {
  it("return the same list when nothing is in flight", () => {
    const cards = [card()];
    expect(overlayAll(cards)).toBe(cards);
    expect(applyIntents(cards)).toBe(cards);
  });

  it("filters a reload through the open intents", () => {
    api.remove.mockReturnValue(new Promise(() => {}));
    void removeNow("b");
    expect(overlayAll([card(), card({ id: "b" })]).map((c) => c.id)).toEqual(["a"]);
  });
});
