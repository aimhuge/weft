import { afterEach, describe, expect, it, vi } from "vitest";

// A worker's host: no project acts, its reads from the snapshot (here, whatever the test sets).
const worker = vi.hoisted((): { pile: unknown; reads: boolean } => ({ pile: null, reads: true }));
vi.mock("./project-host", async (actual) => {
  const real = await actual<typeof import("./project-host")>();
  const cloud = { can: (f: string) => f === "reads" && worker.reads, read: vi.fn(() => Promise.resolve(worker.pile)) };
  return { ...real, hostFor: (cwd: string) => (cwd.startsWith("worker://") ? cloud : real.hostFor(cwd)) };
});

const { fetchPileReview, startPileReview } = await import("./pile-review");

const reply = (body: unknown) => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(JSON.stringify(body))));

afterEach(() => vi.unstubAllGlobals());

describe("fetchPileReview", () => {
  it("asks /api/pile for the walk-through prompt of the folder's repo", async () => {
    const fetch = reply({ prompt: "Walk me through…", title: "Commit the uncommitted pile in weft" });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchPileReview("/a b")).resolves.toEqual({ prompt: "Walk me through…", title: "Commit the uncommitted pile in weft" });
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/pile?cwd=%2Fa%20b&prompt=1");
  });

  it("writes a worker project's prompt from its snapshot's pile, never asking this Mac", async () => {
    const fetch = reply({ prompt: "p" });
    vi.stubGlobal("fetch", fetch);
    worker.pile = { root: "ling", files: 3, added: 10, removed: 2, cards: 1 };
    const { prompt, title } = await fetchPileReview("worker://w1/ling");
    expect(title).toBe("Commit the uncommitted pile in ling");
    expect(prompt).toContain("in ling: 3 files, +10/-2 lines, from 1 cards in Review");
    expect(fetch).not.toHaveBeenCalled();
    worker.pile = null;
    await expect(fetchPileReview("worker://w1/ling")).rejects.toThrow("Nothing uncommitted");
    worker.reads = false;
    await expect(fetchPileReview("worker://w1/ling")).rejects.toThrow("Nothing uncommitted");
    worker.reads = true;
  });

  it("falls back to a plain title", async () => {
    vi.stubGlobal("fetch", reply({ prompt: "p" }));
    await expect(fetchPileReview("/a")).resolves.toEqual({ prompt: "p", title: "Commit the uncommitted pile" });
  });

  it("rejects with the server's error, or says the tree is clean", async () => {
    vi.stubGlobal("fetch", reply({ error: "boom" }));
    await expect(fetchPileReview("/a")).rejects.toThrow("boom");
    vi.stubGlobal("fetch", reply({ pile: null }));
    await expect(fetchPileReview("/a")).rejects.toThrow("Nothing uncommitted to walk through.");
  });
});

describe("startPileReview", () => {
  it("starts the walk-through card and opens it", async () => {
    vi.stubGlobal("fetch", reply({ prompt: "p", title: "t" }));
    const start = vi.fn(() => Promise.resolve<string | undefined>("card-1"));
    const open = vi.fn();
    await startPileReview("/a", start, open);
    expect(start).toHaveBeenCalledWith("/a", "p", "t");
    expect(open).toHaveBeenCalledWith("card-1");
  });

  it("opens nothing when no card came back, or the tree is clean", async () => {
    vi.stubGlobal("fetch", reply({ prompt: "p" }));
    const open = vi.fn();
    await startPileReview("/a", () => Promise.resolve(undefined), open);
    vi.stubGlobal("fetch", reply({}));
    const start = vi.fn(() => Promise.resolve<string | undefined>("card-1"));
    await expect(startPileReview("/a", start, open)).rejects.toThrow("Nothing uncommitted");
    expect(start).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
