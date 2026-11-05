// lib/blob-page-sign.ts: the blob refs a synced page names are swapped for signed URLs where it's served.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveBlobUrls = vi.fn<(...a: unknown[]) => Promise<Record<string, string>>>();
const queueMirror = vi.fn(() => () => undefined);
vi.mock("./blob-urls", () => ({ resolveBlobUrls: (...a: unknown[]) => resolveBlobUrls(...a) }));
vi.mock("./r2-queue", () => ({ queueMirror: (...a: unknown[]) => queueMirror(...(a as [])) }));

const { MAX_PAGE_REFS, pageBlobRefs, signPageAssets, signPageRefs } = await import("./blob-page-sign");

const A = `blob:sha256:${"a".repeat(64)}`;
const B = `blob:sha256:${"b".repeat(64)}`;
const client = {} as SupabaseClient;

beforeEach(() => vi.clearAllMocks());

describe("pageBlobRefs", () => {
  it("lists each distinct ref once, in order, and ignores short or malformed ones", () => {
    expect(pageBlobRefs(`<img src="${B}"><img src="${A}#x"><img src="${B}"><img src="blob:sha256:abc">`)).toEqual([B, A]);
    expect(pageBlobRefs("<p>nothing</p>")).toEqual([]);
  });

  it("caps the list", () => {
    const html = Array.from({ length: MAX_PAGE_REFS + 5 }, (_, i) => `blob:sha256:${i.toString(16).padStart(64, "0")}`).join(" ");
    expect(pageBlobRefs(html)).toHaveLength(MAX_PAGE_REFS);
  });
});

describe("signPageRefs", () => {
  it("swaps signed refs, keeps a #fragment after the URL, and leaves unsigned refs", () => {
    expect(signPageRefs(`<img src="${A}#star"><img src="${B}">`, { [A]: "https://r2/a?sig=1" })).toBe(`<img src="https://r2/a?sig=1#star"><img src="${B}">`);
  });
});

describe("signPageAssets", () => {
  it("returns a page with no refs untouched, without asking", async () => {
    expect(await signPageAssets(client, "org-1", "<p>hi</p>")).toBe("<p>hi</p>");
    expect(resolveBlobUrls).not.toHaveBeenCalled();
  });

  it("signs the page's refs as the given client and queues the unmirrored ones for R2", async () => {
    resolveBlobUrls.mockResolvedValue({ [A]: "https://signed/a" });
    expect(await signPageAssets(client, "org-1", `<img src="${A}">`)).toBe(`<img src="https://signed/a">`);
    expect(resolveBlobUrls).toHaveBeenCalledWith(client, "org-1", [A], { onUnmirrored: expect.any(Function) as unknown });
    expect(queueMirror).toHaveBeenCalledWith("org-1");
  });
});
