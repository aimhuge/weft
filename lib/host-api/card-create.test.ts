// card.create: a new card under the id the board picked, started or left in Backlog, never twice under one id.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const made = vi.hoisted(() => new Map<string, Card>());

vi.mock("@/lib/store", () => ({ getCard: vi.fn((id: string) => made.get(id)) }));
vi.mock("@/lib/new-card", () => ({
  createCardFromBody: vi.fn((body: Record<string, unknown>, id: string) => ({ id, column: "backlog", ...body }) as unknown as Card),
  startCard: vi.fn(() => ({ started: true })),
}));

const { createCardFromBody, startCard } = await import("@/lib/new-card");
const { createCardVerb } = await import("./card-create");

beforeEach(() => {
  made.clear();
  vi.clearAllMocks();
});

describe("createCardVerb", () => {
  it("makes the card under the board's id with every field but start, and starts it", async () => {
    const got = await createCardVerb({ id: "1234abcd-0000", prompt: "Fix it", tags: ["bug"], isolated: true, model: "m", backend: "codex", effort: "high", permissionMode: "plan" });
    expect(createCardFromBody).toHaveBeenCalledWith({ prompt: "Fix it", tags: ["bug"], isolated: true, model: "m", backend: "codex", effort: "high", permissionMode: "plan" }, "1234abcd-0000");
    expect(startCard).toHaveBeenCalledOnce();
    expect(got.start).toEqual({ started: true });
    expect(got.card.id).toBe("1234abcd-0000");
  });

  it("leaves it in Backlog on start: false", async () => {
    const got = await createCardVerb({ id: "1234abcd-0001", prompt: "Later", start: false });
    expect(startCard).not.toHaveBeenCalled();
    expect(got.start).toEqual({ started: false });
  });

  it("refuses an id that isn't one, and one that's taken", async () => {
    await expect(createCardVerb({ id: "../x", prompt: "p" })).rejects.toThrow("isn't one");
    made.set("1234abcd-0002", { id: "1234abcd-0002" } as Card);
    await expect(createCardVerb({ id: "1234abcd-0002", prompt: "p" })).rejects.toThrow("already on this host");
    expect(createCardFromBody).not.toHaveBeenCalled();
  });
});
