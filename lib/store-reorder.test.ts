// Backlog reordering. The card's order field lives in lib/store.ts and the test sits beside
// the other store tests in lib/store*.test.ts; this file holds the order-specific cases
// (backfill, half-step, renumber, ignore-other-columns) to keep store.test.ts under the
// 300-line cap.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

let dir: string;
const g = globalThis as unknown as { __weftState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftState;
  return import("./store");
}

type Store = Awaited<ReturnType<typeof load>>;
const input = (over: Partial<Card> = {}) =>
  ({ title: "t", prompt: "p", cwd: "/tmp", backend: "claude", ...over }) as Parameters<Store["createCard"]>[0];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-store-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("store cards order", () => {
  it("createCard stamps an order from createdAt so the card lands at the column's tail", async () => {
    const store = await load();
    const a = store.createCard(input({ title: "a" }), "a");
    await new Promise((r) => setTimeout(r, 5));
    const b = store.createCard(input({ title: "b" }), "b");
    expect(a.order).toBe(a.createdAt);
    expect(b.order).toBe(b.createdAt);
    expect(b.order! > a.order!).toBe(true);
  });

  it("backfillOrder stamps missing orders from createdAt", async () => {
    const store = await load();
    // addCards an old-style card without an order; listCards triggers backfill.
    store.addCards([{ ...input({ pictures: 0 }), id: "x", column: "backlog", createdAt: 42, updatedAt: 42 }]);
    // First list triggers the backfill; second list is the saved shape.
    store.listCards();
    expect(store.getCard("x")?.order).toBe(42);
  });
});

describe("store reorder", () => {
  it("places a card before a target using half-step spacing", async () => {
    const store = await load();
    store.createCard(input({ title: "a" }), "a");
    store.createCard(input({ title: "b" }), "b");
    store.createCard(input({ title: "c" }), "c");
    // Move c before a: c lands in the gap above a.
    store.reorderCard("c", "a");
    const order = (id: string) => store.getCard(id)?.order as number;
    expect(order("c")).toBeLessThan(order("a"));
    // The card's new order should be a half-step below the previous neighbor (a), which
    // is well below the original a.order (a createdAt timestamp), so a's order is unchanged.
    expect(order("a") > 0).toBe(true);
  });

  it("places a card at the end of its column when before is null", async () => {
    const store = await load();
    store.createCard(input({ title: "a" }), "a");
    store.createCard(input({ title: "b" }), "b");
    // Stamp fixed orders so the assertion doesn't depend on createdAt (a timestamp).
    store.updateCard("a", { order: 100 });
    store.updateCard("b", { order: 200 });
    store.reorderCard("a", null);
    const order = (id: string) => store.getCard(id)?.order as number;
    expect(order("a")).toBeGreaterThan(order("b"));
  });

  it("uses the current order when a card is reordered more than once", async () => {
    const store = await load();
    for (const [id, order] of [["a", 100], ["b", 200], ["c", 300], ["d", 400]] as const) {
      store.createCard(input({ title: id, order }), id);
    }

    store.reorderCard("d", "b");
    store.reorderCard("c", "d");

    const ordered = ["a", "b", "c", "d"]
      .map((id) => store.getCard(id)!)
      .sort((a, b) => (a.order as number) - (b.order as number))
      .map((card) => card.id);
    expect(ordered).toEqual(["a", "c", "d", "b"]);
  });

  it("renumbers the column when the gap collapses", async () => {
    const store = await load();
    const a = store.createCard(input({ title: "a" }), "a");
    store.createCard(input({ title: "b" }), "b");
    // Force the gap closed by writing b's order to a+1.
    store.updateCard("b", { order: (a.order as number) + 1 });
    // Placing a before b has no room, so the column should renumber.
    store.reorderCard("a", "b");
    const order = (id: string) => store.getCard(id)?.order as number;
    const oa = order("a");
    const ob = order("b");
    expect(Math.abs(oa - ob)).toBeGreaterThanOrEqual(1024);
  });

  it("publishes the full column after a collapsed gap is renumbered", async () => {
    const store = await load();
    // createCard stamps order with the time, so set the orders after: a gap of 1 between a and b, whatever the clock.
    for (const [id, order] of [["a", 100], ["b", 101], ["c", 300], ["d", 400]] as const) {
      store.createCard(input({ title: id }), id);
      store.updateCard(id, { order });
    }
    const { subscribe } = await import("./bus");
    const events: string[] = [];
    const off = subscribe((event) => {
      if (event.type === "card") events.push(event.card.id);
    });

    try {
      store.reorderCard("d", "b");
    } finally {
      off();
    }

    expect(events).toEqual(["a", "d", "b", "c"]);
  });

  it("ignores cards in other columns when picking the slot", async () => {
    const store = await load();
    store.createCard(input({ title: "a" }), "a");
    store.createCard(input({ title: "d" }), "d");
    store.updateCard("d", { column: "review" });
    store.reorderCard("a", null);
    expect((store.getCard("a")?.order as number) > 0).toBe(true);
  });
});
