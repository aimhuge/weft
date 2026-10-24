import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const h = vi.hoisted(() => ({ cards: new Map<string, Partial<Card>>(), land: vi.fn(), ret: vi.fn() }));
vi.mock("./store", () => ({
  getCard: (id: string) => h.cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => h.cards.set(id, { ...h.cards.get(id), ...patch }),
}));
vi.mock("./settings", () => ({ pushOnDone: () => true }));
vi.mock("./worktree-land", () => ({ landWorktree: h.land }));
vi.mock("./worktree-pool", () => ({ returnWorktree: h.ret }));

const { landCard, landNote } = await import("./worktree-done");
const worktree = { path: "/w", branch: "weft/fix-1", base: "b", repo: "/r" };
const send = vi.fn();

beforeEach(() => {
  h.cards.clear();
  h.cards.set("c1", { id: "c1", title: "Fix", isolated: true, worktree, claims: ["/w/a.ts#*"], column: "done", wrappingUp: true });
  h.land.mockReset();
  h.ret.mockReset().mockResolvedValue(undefined);
  send.mockReset();
});

describe("landCard", () => {
  it("files a landed card away, worktree back to the pool, still isolated for any reply", async () => {
    h.land.mockResolvedValue({ ok: true, commit: "abc1234", onto: "main", pushed: true });
    await landCard("c1", send);
    expect(h.land).toHaveBeenCalledWith(worktree, "Fix", { push: true });
    expect(h.ret).toHaveBeenCalledWith(worktree);
    expect(h.cards.get("c1")).toMatchObject({ isolated: true, worktree: undefined, claims: undefined, archived: true, wrappingUp: false, lastLine: "Landed on main (abc1234), pushed" });
  });

  it("keeps a starred card on the board, and says when there was nothing to land", async () => {
    h.cards.set("c1", { ...h.cards.get("c1"), starred: true });
    h.land.mockResolvedValue({ ok: true, commit: "abc", onto: "main", pushed: false, nothing: true });
    h.ret.mockRejectedValue(new Error("busy"));
    await landCard("c1", send);
    expect(h.cards.get("c1")).toMatchObject({ archived: false, lastLine: "Nothing to land" });
  });

  it("sends a conflict back to the thread to resolve", async () => {
    h.land.mockResolvedValue({ ok: false, kind: "conflict", files: ["a.ts"], onto: "main", message: "x" });
    await landCard("c1", send);
    expect(send).toHaveBeenCalledWith("c1", expect.stringContaining("`git rebase main`"));
    expect(h.cards.get("c1")!.worktree).toEqual(worktree);
    expect(h.ret).not.toHaveBeenCalled();
  });

  it("leaves the card in Review when the main tree holds another card's changes, or the send fails", async () => {
    h.land.mockResolvedValue({ ok: false, kind: "dirty", files: ["shared.ts"], message: "The main tree has uncommitted changes to shared.ts." });
    await landCard("c1", send);
    expect(send).not.toHaveBeenCalled();
    expect(h.cards.get("c1")).toMatchObject({ column: "review", archived: false, lastLine: "Couldn't land its branch" });
    expect(h.cards.get("c1")!.error).toContain("shared.ts");
    h.land.mockResolvedValue({ ok: false, kind: "commit", files: [], message: "hook failed." });
    send.mockImplementation(() => {
      throw new Error("busy");
    });
    await landCard("c1", send);
    expect(h.cards.get("c1")!.error).toContain("hook failed.");
  });

  it("turns a thrown error into a Review note, and skips a card with no worktree", async () => {
    h.land.mockRejectedValue(new Error("git died"));
    await landCard("c1", send);
    expect(h.cards.get("c1")!.error).toContain("git died");
    h.land.mockRejectedValue("plain");
    await landCard("c1", send);
    expect(h.cards.get("c1")!.error).toContain("plain");
    h.land.mockReset();
    await landCard("missing", send);
    expect(h.land).not.toHaveBeenCalled();
  });
});

describe("landNote", () => {
  it("names the conflicting files, or says main when it doesn't know the branch", () => {
    expect(landNote("weft/a", { ok: false, kind: "conflict", files: [], message: "" })).toContain("`git rebase main`");
    expect(landNote("weft/a", { ok: false, kind: "conflict", files: ["x.ts", "y.ts"], onto: "dev", message: "" })).toContain("conflicts in x.ts, y.ts");
  });
});
