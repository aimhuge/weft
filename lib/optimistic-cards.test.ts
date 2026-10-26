import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const api = vi.hoisted(() => ({ remove: vi.fn(), stop: vi.fn(), waitPermission: vi.fn(), putFirst: vi.fn() }));
vi.mock("./client", () => ({ api }));

import { answerNow, applyIntents, firstNow, forget, onOptimistic, overlay, overlayAll, patchNow, removeNow, STOP_SETTLE_MS, stopNow, waitNow, type OptimisticUpdate } from "./optimistic-cards";

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

const asking = (over: Partial<NonNullable<Card["pending"]>> = {}) =>
  card({ column: "needs_you", pending: { id: "p", title: "Edit x.ts", why: { holder: { title: "Other" } }, ...over } as Card["pending"] });

describe("answerNow / waitNow / firstNow", () => {
  beforeEach(() => {
    api.waitPermission.mockReset().mockResolvedValue({ ok: true });
    api.putFirst.mockReset().mockResolvedValue({ ok: true });
  });

  it("takes an answered prompt off the card at once, until the server moves past it", async () => {
    const call = vi.fn().mockResolvedValue({ ok: true });
    await answerNow("a", "p", false, call);
    expect(call).toHaveBeenCalled();
    expect(applyIntents([asking()])[0]).toMatchObject({ column: "running", pending: null, lastLine: "Denied: Edit x.ts" });
    // A stale server copy still asking stays drawn answered; the next request ends the intent.
    expect(overlay(asking())?.pending).toBeNull();
    const next = asking({ id: "q" });
    expect(overlay(next)).toBe(next);
    expect(overlay(asking())?.pending?.id).toBe("p");
  });

  it("Me first goes ahead now and calls putFirst", async () => {
    await firstNow("a", "p");
    expect(api.putFirst).toHaveBeenCalledWith("a", "p");
    expect(applyIntents([asking()])[0]).toMatchObject({ pending: null, lastLine: "Allowed: Edit x.ts" });
  });

  it("Wait shows the card waiting now, until the server shows it waiting", async () => {
    await waitNow("a", "p");
    expect(api.waitPermission).toHaveBeenCalledWith("a", "p");
    expect(applyIntents([asking()])[0]).toMatchObject({ column: "running", pending: { id: "p", waiting: true }, lastLine: "Waiting for ‘Other’" });
    const waiting = asking({ waiting: true });
    expect(overlay(waiting)).toBe(waiting);
  });

  it("leaves a card whose prompt is another one alone", async () => {
    await answerNow("a", "p", true, () => Promise.resolve());
    const other = asking({ id: "z" });
    expect(applyIntents([other])[0]).toBe(other);
  });

  it("brings the prompt back by reload when the server refuses", async () => {
    await expect(answerNow("a", "p", true, () => Promise.reject(new Error("gone")))).rejects.toThrow("gone");
    expect(updates).toEqual([{ kind: "apply" }, { kind: "reload" }]);
    expect(overlay(asking())?.pending?.id).toBe("p");
  });
});

describe("patchNow", () => {
  it("draws the fields now and lets go once the server's card has them", async () => {
    await patchNow("a", { starred: true }, () => Promise.resolve());
    expect(applyIntents([card()])[0]?.starred).toBe(true);
    expect(overlay(card())?.starred).toBe(true);
    expect(overlay(card({ starred: true }))?.starred).toBe(true);
    expect(overlay(card())?.starred).toBeUndefined();
  });

  it("reads false, missing and [] as the same unset value", async () => {
    await patchNow("a", { starred: false, tags: [] }, () => Promise.resolve());
    const plain = card();
    expect(overlay(plain)).toBe(plain);
  });

  it("merges a second change, and an older call's timeout leaves it be", async () => {
    vi.useFakeTimers();
    await patchNow("a", { starred: true }, () => Promise.resolve());
    vi.advanceTimersByTime(STOP_SETTLE_MS / 2);
    await patchNow("a", { title: "B" }, () => Promise.resolve());
    vi.advanceTimersByTime(STOP_SETTLE_MS / 2);
    expect(applyIntents([card()])[0]).toMatchObject({ starred: true, title: "B" });
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(updates.at(-1)).toEqual({ kind: "reload" });
    expect(applyIntents([card()])[0]?.title).toBe("A");
  });

  it("reloads and rethrows when the server refuses, and forget drops it", async () => {
    await expect(patchNow("a", { archived: true }, () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(updates).toEqual([{ kind: "apply" }, { kind: "reload" }]);
    void patchNow("b", { archived: true }, () => new Promise(() => {}));
    expect(overlayAll([card({ id: "b" })])[0]?.archived).toBe(true);
    forget("b");
    expect(overlayAll([card({ id: "b" })])[0]?.archived).toBeUndefined();
  });
});
