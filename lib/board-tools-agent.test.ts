import { describe, expect, it, vi } from "vitest";

// createBoardCard with an agent (lib/agents.ts): the card a thread or the copilot starts gets the soul it asked for.

vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  createCard: vi.fn((body: Record<string, unknown>) => ({ id: "c1", ...body })),
}));
vi.mock("./folders", () => ({ resolveFolder: vi.fn((folder: string) => folder) }));
vi.mock("./settings", async (importOriginal) => ({ ...(await importOriginal<typeof import("./settings")>()), touchProject: vi.fn() }));

const { createBoardCard } = await import("./board-tools");

describe("createBoardCard with an agent", () => {
  it("gives the card the agent asked for; Builder and none store nothing", () => {
    expect(createBoardCard({ prompt: "x", folder: "/w", permissionMode: "auto", agent: "copywriter" }).agent).toBe("copywriter");
    expect(createBoardCard({ prompt: "x", folder: "/w", permissionMode: "auto", agent: "builder" })).not.toHaveProperty("agent");
    expect(createBoardCard({ prompt: "x", folder: "/w", permissionMode: "auto" })).not.toHaveProperty("agent");
  });
});
