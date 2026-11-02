// The session line's events (lib/host-line-events.ts): the relay's own projection, and the copilot left out.
import { describe, expect, it } from "vitest";
import { lineProjector } from "./host-line-events";
import type { RowHost } from "./card-rows";
import type { Card, ThreadItem } from "./types";

const host: RowHost = { orgId: "org-1", thumbs: false, copilot: false };
const card = { id: "c1", title: "Deploy with sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", cwd: "/w/app", column: "running" } as Card;
const copilot = { ...card, id: "co", role: "copilot" } as Card;
const cards: Record<string, Card> = { c1: card, co: copilot };
const project = lineProjector(host, (id) => cards[id]);
const item = { kind: "assistant", text: "the key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", at: 1 } as unknown as ThreadItem;

describe("lineProjector", () => {
  it("sends a card and an item redacted, as their rows carry them", async () => {
    const sent = await project({ type: "card", card });
    expect(sent).toMatchObject({ t: "card", card: { id: "c1" } });
    expect(JSON.stringify(sent)).not.toContain("abcdefghijklmnop");
    const thread = await project({ type: "thread", cardId: "c1", index: 3, item, truncate: true });
    expect(thread).toMatchObject({ t: "thread", cardId: "c1", index: 3, truncate: true, item: { kind: "assistant" } });
    expect(JSON.stringify(thread)).not.toContain("abcdefghijklmnop");
    expect(await project({ type: "thread", cardId: "c1", index: 4, item })).not.toHaveProperty("truncate");
  });

  it("passes deletes and clears, and leaves out the copilot, unknown cards and the rest of the bus", async () => {
    expect(await project({ type: "card_deleted", id: "c1" })).toEqual({ t: "card_deleted", id: "c1" });
    expect(await project({ type: "thread_cleared", cardId: "c1" })).toEqual({ t: "thread_cleared", cardId: "c1" });
    expect(await project({ type: "thread_cleared", cardId: "co" })).toBeNull();
    expect(await project({ type: "card", card: copilot })).toBeNull();
    expect(await project({ type: "thread", cardId: "co", index: 0, item })).toBeNull();
    expect(await project({ type: "thread", cardId: "gone", index: 0, item })).toBeNull();
    expect(await project({ type: "delta", cardId: "c1", text: "x" })).toBeNull();
  });
});
