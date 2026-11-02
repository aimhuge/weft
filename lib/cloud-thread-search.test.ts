// ⌘F over a whole synced thread on weft.zip (lib/cloud-thread-search.ts): batches read oldest first, each row matched at its seq.
import { describe, expect, it, vi } from "vitest";
import { SEARCH_BATCH, SEARCH_MAX, searchCloudThread } from "./cloud-thread-search";

const row = (seq: number, text: string) => ({ card_id: "c1", seq, item: { kind: "assistant", text } as never });

describe("searchCloudThread", () => {
  it("matches every row at its own seq, across batches, until a short batch", async () => {
    const full = Array.from({ length: SEARCH_BATCH }, (_, i) => row(i, i === 3 ? "a needle and a NEEDLE" : "hay"));
    const read = vi.fn((after: number) => Promise.resolve(after < 0 ? full : [row(5000, "needle"), { card_id: "c2", seq: 5001, item: { kind: "assistant", text: "needle" } as never }]));
    await expect(searchCloudThread("c1", "needle", read)).resolves.toEqual([
      { index: 3, hits: 2 },
      { index: 5000, hits: 1 },
    ]);
    expect(read.mock.calls.map(([after]) => after)).toEqual([-1, SEARCH_BATCH - 1]);
  });

  it("finds nothing for no query, and nothing it can't read", async () => {
    const read = vi.fn(() => Promise.resolve(null));
    await expect(searchCloudThread("c1", "", read)).resolves.toEqual([]);
    expect(read).not.toHaveBeenCalled();
    await expect(searchCloudThread("c1", "x", read)).resolves.toBeNull();
  });

  it("stops at SEARCH_MAX rows, and at an empty batch", async () => {
    let seq = 0;
    const read = vi.fn(() => Promise.resolve(Array.from({ length: SEARCH_BATCH }, () => row(seq++, "x"))));
    await searchCloudThread("c1", "x", read);
    expect(read).toHaveBeenCalledTimes(SEARCH_MAX / SEARCH_BATCH);
    await expect(searchCloudThread("c1", "x", () => Promise.resolve([]))).resolves.toEqual([]);
  });
});
