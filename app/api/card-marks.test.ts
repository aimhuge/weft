import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

// PATCH /api/cards/:id with ★ and tags (the rest of that route is in app/api/routes.test.ts).

const cards = new Map<string, Partial<Card>>();
vi.mock("@/lib/store", () => ({
  getCard: vi.fn((id: string) => cards.get(id)),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => cards.set(id, { ...cards.get(id), ...patch })),
  deleteCard: vi.fn(),
}));
vi.mock("@/lib/runner", () => ({}));
vi.mock("@/lib/automations", () => ({}));
vi.mock("@/lib/settings", () => ({}));
vi.mock("@/lib/folders", () => ({}));
vi.mock("@/lib/tag-store", () => ({ rememberTags: vi.fn() }));

const route = await import("./cards/[id]/route");
const tagStore = await import("@/lib/tag-store");

function patch(body: unknown) {
  const req = new Request("http://localhost:3457/api/cards/c1", {
    method: "PATCH",
    headers: { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return route.PATCH(req, { params: Promise.resolve({ id: "c1" }) });
}

beforeEach(() => {
  cards.clear();
  cards.set("c1", { id: "c1", column: "review" });
});

describe("PATCH /api/cards/:id marks", () => {
  it("dismisses the Broke Weft mark with broke: null", async () => {
    cards.set("c1", { id: "c1", column: "review", broke: { kind: "server", at: 1, why: "w" } });
    await patch({ starred: true });
    expect(cards.get("c1")?.broke).toBeDefined();
    await patch({ broke: null });
    expect(cards.get("c1")?.broke).toBeUndefined();
  });

  it("stars and unstars", async () => {
    await patch({ starred: true });
    expect(cards.get("c1")?.starred).toBe(true);
    await patch({ starred: false });
    expect(cards.get("c1")?.starred).toBe(false);
  });

  it("sets tags as yours, normalized, and refuses anything but a list", async () => {
    await patch({ tags: ["  Bug  Fix ", "#UI", "ui"] });
    expect(cards.get("c1")).toMatchObject({ tags: ["bug fix", "ui"], tagsBy: "user" });
    expect(tagStore.rememberTags).toHaveBeenLastCalledWith(["bug fix", "ui"]);
    expect((await patch({ tags: "bug" })).status).toBe(400);
  });
});
