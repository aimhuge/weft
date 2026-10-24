import { describe, expect, it, vi } from "vitest";
import { backfillSlug, defaultAppSlug, isDuplicateSlug, slugCandidates, writeWithFreeSlug } from "./app-share-slug";
import type { AppShareRow, Ready } from "./app-share-row";

const DUP = { message: 'duplicate key value violates unique constraint "cloud_app_shares_user_slug"' };

describe("defaultAppSlug", () => {
  it("is the app's folder name for a folder app, else the slug of its name", () => {
    expect(defaultAppSlug({ name: "📈 Growth", url: "file:///Users/me/.weft/apps/growth-board/index.html" })).toBe("growth-board");
    expect(defaultAppSlug({ name: "📈 Growth", url: "file:///Users/me/page.html" })).toBe("growth");
    expect(defaultAppSlug({ name: "📈 Growth", url: "https://example.com/" })).toBe("growth");
  });
});

describe("slugCandidates", () => {
  it("tries the base, then -2 to -9, every one inside the 40-character rule", () => {
    expect(slugCandidates("growth")).toEqual(["growth", "growth-2", "growth-3", "growth-4", "growth-5", "growth-6", "growth-7", "growth-8", "growth-9"]);
    const long = "a".repeat(37) + "-bc";
    for (const slug of slugCandidates(long)) expect(slug.length).toBeLessThanOrEqual(40);
    expect(slugCandidates(long)[1]).toBe("a".repeat(37) + "-2");
    expect(slugCandidates("a".repeat(38) + "-b")[1]).toBe("a".repeat(38) + "-2");
  });
});

describe("isDuplicateSlug", () => {
  it("knows a unique-index violation", () => {
    expect(isDuplicateSlug(DUP)).toBe(true);
    expect(isDuplicateSlug({ message: "slug already exists" })).toBe(true);
    expect(isDuplicateSlug({ message: "denied" })).toBe(false);
    expect(isDuplicateSlug(null)).toBe(false);
  });
});

describe("writeWithFreeSlug", () => {
  it("writes the base when it's free", async () => {
    const write = vi.fn(() => Promise.resolve(null));
    expect(await writeWithFreeSlug("growth", write)).toBeNull();
    expect(write.mock.calls).toEqual([["growth"]]);
  });

  it("moves on to the next free candidate past a taken one", async () => {
    const write = vi.fn((slug: string | null) => Promise.resolve(slug === "growth" ? DUP : null));
    expect(await writeWithFreeSlug("growth", write)).toBeNull();
    expect(write.mock.calls).toEqual([["growth"], ["growth-2"]]);
  });

  it("writes with no slug once every candidate is taken", async () => {
    const write = vi.fn((slug: string | null) => Promise.resolve(slug ? DUP : null));
    expect(await writeWithFreeSlug("growth", write)).toBeNull();
    expect(write).toHaveBeenCalledTimes(10);
    expect(write).toHaveBeenLastCalledWith(null);
  });

  it("stops at any other error and hands it back", async () => {
    const write = vi.fn(() => Promise.resolve({ message: "denied" }));
    expect(await writeWithFreeSlug("growth", write)).toEqual({ message: "denied" });
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("backfillSlug", () => {
  const row = { id: "s1", slug: null } as AppShareRow;
  function ready(answer: (slug: string) => { message: string } | null) {
    const updates: { change: Record<string, unknown>; id: unknown }[] = [];
    const client = {
      from: () => ({
        update: (change: { slug: string }) => ({
          eq: (_col: string, id: unknown) => {
            updates.push({ change, id });
            return Promise.resolve({ error: answer(change.slug) });
          },
        }),
      }),
    };
    const t = { client, app: { name: "📈 Growth", url: "https://example.com/" } } as unknown as Ready;
    return { t, updates };
  }

  it("leaves a row that has a slug alone", async () => {
    const { t, updates } = ready(() => null);
    const named = { ...row, slug: "mine" };
    expect(await backfillSlug(t, named)).toBe(named);
    expect(updates).toEqual([]);
  });

  it("gives a slugless row its default, or the next free one", async () => {
    const free = ready(() => null);
    expect(await backfillSlug(free.t, row)).toEqual({ ...row, slug: "growth" });
    expect(free.updates).toEqual([{ change: { slug: "growth" }, id: "s1" }]);
    const taken = ready((slug) => (slug === "growth" ? DUP : null));
    expect(await backfillSlug(taken.t, row)).toEqual({ ...row, slug: "growth-2" });
  });

  it("keeps the row as it was when nothing could be written", async () => {
    expect(await backfillSlug(ready(() => DUP).t, row)).toBe(row);
    expect(await backfillSlug(ready(() => ({ message: "denied" })).t, row)).toBe(row);
  });
});
