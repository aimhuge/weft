import { beforeEach, describe, expect, it, vi } from "vitest";

// Writing a folder grant on the machine running the card, with the store and settings mocked.
const h = vi.hoisted(() => ({ card: undefined as { id: string; cwd: string; readScope?: string[] } | undefined, allowed: [] as string[], updates: [] as unknown[] }));
vi.mock("./store", () => ({ getCard: () => h.card, updateCard: (_id: string, patch: unknown) => h.updates.push(patch) }));
vi.mock("./settings", () => ({ allowFolder: (folder: string) => h.allowed.push(folder) }));

const { applyFolderGrant } = await import("./folder-grant");

beforeEach(() => {
  h.card = { id: "c1", cwd: "/srv/work/app", readScope: ["/srv/shared"] };
  h.allowed = [];
  h.updates = [];
});

describe("applyFolderGrant", () => {
  it("adds This card to the card's read scope and leaves the machine's list alone", () => {
    applyFolderGrant("c1", "/srv/data", "card");
    expect(h.updates).toEqual([{ readScope: ["/srv/shared", "/srv/data"] }]);
    expect(h.allowed).toEqual([]);
  });

  it("adds Always to this machine's allowed folders and leaves the card alone", () => {
    applyFolderGrant("c1", "/srv/data", "always");
    expect(h.allowed).toEqual(["/srv/data"]);
    expect(h.updates).toEqual([]);
  });

  it("does nothing for a card that has gone", () => {
    h.card = undefined;
    applyFolderGrant("c1", "/srv/data", "card");
    expect(h.updates).toEqual([]);
  });
});
