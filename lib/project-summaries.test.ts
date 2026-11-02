// The header's pile and Backlog counts (lib/project-summaries.ts), shared by this Mac's routes and a worker's snapshot.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

vi.mock("./show-dir", () => ({ SHOW_DIR: "/weft/show" }));
const pile = vi.hoisted(() => ({ readPile: vi.fn(), repoRoot: vi.fn() }));
vi.mock("./commit-pile", async (load) => ({ ...(await load<typeof import("./commit-pile")>()), readPile: pile.readPile, repoRoot: pile.repoRoot }));

const { backlogOf, pileOf } = await import("./project-summaries");

const card = (over: Partial<Card>): Card => ({ id: "c", title: "t", cwd: "/repo", column: "review", createdAt: 0, ...over }) as Card;

beforeEach(() => vi.clearAllMocks());

describe("pileOf", () => {
  it("is null for a clean folder", () => {
    pile.readPile.mockReturnValueOnce(null);
    expect(pileOf("/repo", [])).toBeNull();
  });

  it("counts the files, lines and the cards they belong to", () => {
    pile.readPile.mockReturnValueOnce({ root: "/repo", files: [{ path: "a.ts", code: " M" }], added: 3, removed: 1 });
    const found = pileOf("/repo", [card({ id: "c1", files: ["/repo/a.ts"] } as Partial<Card>)]);
    expect(found?.summary).toMatchObject({ root: "/repo", files: 1, added: 3, removed: 1 });
    expect(typeof found?.summary.cards).toBe("number");
  });
});

describe("backlogOf", () => {
  it("counts the repo's Backlog, and is null when nothing waits", () => {
    pile.repoRoot.mockReturnValue("/repo");
    expect(backlogOf("/repo/sub", [card({ column: "backlog" }), card({ id: "c2", column: "running" })])?.summary).toEqual({ root: "/repo", count: 1, active: 1 });
    expect(backlogOf("/repo", [])).toBeNull();
  });

  it("takes the folder itself when it isn't a repo", () => {
    pile.repoRoot.mockImplementationOnce(() => {
      throw new Error("not a repo");
    });
    expect(backlogOf("/loose", [card({ cwd: "/loose", column: "backlog" })])?.root).toBe("/loose");
  });
});
