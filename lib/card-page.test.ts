import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards = new Map<string, Card>();
const decorateCard = vi.fn((id: string, patch: Partial<Card>) => Object.assign(cards.get(id)!, patch));
vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id), decorateCard }));
const { notePage } = await import("./card-page");

beforeEach(() => {
  cards.clear();
  decorateCard.mockClear();
  cards.set("a", { id: "a", title: "a", prompt: "", cwd: "/f", backend: "claude", permissionMode: "default", column: "running", createdAt: 0, updatedAt: 0 });
});

describe("notePage", () => {
  it("keeps the page the pane opened and counts every one, the same file again included", () => {
    notePage("a", "file:///Users/me/.weft/show/a.html");
    notePage("a", " https://x.test/#top ");
    notePage("a", "https://x.test/#top");
    expect(cards.get("a")).toMatchObject({ page: "https://x.test/#top", pages: 3 });
  });

  it("ignores no card, an unknown card, a blank page and about:blank", () => {
    notePage(undefined, "https://x.test");
    notePage("gone", "https://x.test");
    notePage("a", "  ");
    notePage("a", "about:blank");
    expect(decorateCard).not.toHaveBeenCalled();
  });
});
