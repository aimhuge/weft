// The one re-point rule (lib/card-repoint.ts): refuse while a turn is running, end the session,
// then patch the card. The order is the point — the patch comes last, so the session's wind-down
// can't write the card's session id and stats back over the new identity.
import { describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const store = vi.hoisted(() => ({ cards: new Map<string, Card>(), updates: [] as { id: string; patch: Partial<Card> }[] }));

vi.mock("./store", () => ({
  DATA_DIR: "/nonexistent-weft-repoint-test-data",
  getCard: (id: string) => store.cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => {
    store.updates.push({ id, patch });
    const card = store.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch);
    return card;
  },
}));

const { repointCard } = await import("./card-repoint");

function addCard(over: Partial<Card> = {}): Card {
  const id = `card-${store.cards.size + 1}`;
  const card: Card = {
    id,
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "auto",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
  store.cards.set(id, card);
  return card;
}

describe("repointCard", () => {
  it("ends the session and then patches the card, in that order", async () => {
    const card = addCard();
    const order: string[] = [];
    const runner = {
      isBusy: () => false,
      endSession: () => {
        order.push("end");
        return Promise.resolve();
      },
    };
    await repointCard(card, { backend: "puku" }, "Stop the thread before switching its CLI.", runner);
    order.push("patch");
    expect(order).toEqual(["end", "patch"]);
    expect(store.updates.at(-1)).toEqual({ id: card.id, patch: { backend: "puku" } });
    expect(card.backend).toBe("puku");
  });

  it("refuses while a turn is running, and leaves the card alone", async () => {
    const card = addCard();
    const endSession = vi.fn();
    const before = store.updates.length;
    await expect(
      repointCard(card, { backend: "puku" }, "Stop the thread before switching its CLI.", { isBusy: () => true, endSession }),
    ).rejects.toThrow("Stop the thread before switching its CLI.");
    expect(endSession).not.toHaveBeenCalled();
    expect(store.updates).toHaveLength(before);
    expect(card.backend).toBe("claude");
  });
});
