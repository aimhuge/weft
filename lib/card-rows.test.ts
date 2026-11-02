import { describe, expect, it, vi } from "vitest";
import { lastPerKey, projectCard, projectItem, publishes, type RowHost } from "./card-rows";
import { TOOL_RESULT_INLINE_MAX } from "./cloud-sync-types";
import type { Card, ThreadItem } from "./types";

// Built at run time so the pre-commit secret scan doesn't take the fixture for a real key.
const KEY = ["ghp", "_", "Zx81Qa7Lm2Pw9Rt4Vb6Nc3Hd5Kf0Gj8Ys1Ue"].join("");
const REF = `blob:sha256:${"b".repeat(64)}` as const;

const card = (over: Partial<Card> = {}): Card => ({ id: "c1", title: "t", prompt: "", cwd: "/srv/work/app", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over });

const blobs = (over: Partial<NonNullable<RowHost["blobs"]>> = {}): NonNullable<RowHost["blobs"]> => ({
  upload: vi.fn(() => Promise.resolve(null)),
  rewriteItem: vi.fn((item: ThreadItem) => Promise.resolve(item)),
  ...over,
});

const host = (over: Partial<RowHost> = {}): RowHost => ({ orgId: "o1", thumbs: true, copilot: true, ...over });

describe("projectCard", () => {
  it("leaves a card with no blob store as it is, redacted, with empty page columns", async () => {
    const out = await projectCard(card({ title: `key ${KEY}`, page: "https://example.com/", pages: 2 }), host());
    expect(out.card.title).not.toContain(KEY);
    expect(out).toMatchObject({ page: null, page_thumb: null, pages: 2, card: { page: "https://example.com/" } });
  });

  it("counts no pages when the card has none", async () => {
    expect((await projectCard(card(), host())).pages).toBe(0);
  });

  // Before one projection, the Mac's page column was taken from the card before redaction: a key in a page's URL
  // was hidden in card.page and plain in the column beside it.
  it("redacts the page column like the card's own page", async () => {
    const out = await projectCard(card({ page: `https://example.com/?token=${KEY}` }), host({ blobs: blobs() }));
    expect(out.page).toBe(out.card.page);
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it("scrubs what Postgres refuses", async () => {
    expect((await projectCard(card({ title: "a\u0000b" }), host())).card.title).toBe("ab");
  });

  it("keeps page_thumb out when the host has no thumbs, and doesn't upload the thumb", async () => {
    const store = blobs();
    const out = await projectCard(card({ page: "http://localhost:3000/", thumb: "https://example.com/t.png" }), host({ blobs: store, thumbs: false }));
    expect(out).toMatchObject({ page: "http://localhost:3000/", page_thumb: null });
    expect(store.upload).not.toHaveBeenCalled();
  });

  it("fills page_thumb from the thumb when the host has thumbs", async () => {
    const out = await projectCard(card({ page: "http://localhost:3000/", thumb: "https://example.com/t.png" }), host({ blobs: blobs() }));
    expect(out.page_thumb).toBe("https://example.com/t.png");
  });

  it("throws a failed upload for a host without onBlobError", async () => {
    const mod = await import("./card-rows-blobs");
    const spy = vi.spyOn(mod, "withUploadedPage").mockRejectedValueOnce(new Error("offline"));
    await expect(projectCard(card({ page: "https://example.com/" }), host({ blobs: blobs() }))).rejects.toThrow("offline");
    spy.mockRestore();
  });

  it("logs a failed upload and keeps the card for a host with onBlobError", async () => {
    const onBlobError = vi.fn();
    const mod = await import("./card-rows-blobs");
    const spy = vi.spyOn(mod, "withUploadedPage").mockRejectedValueOnce(new Error("offline"));
    const local = card({ page: "/home/me/plan.html", pages: 1 });
    const out = await projectCard(local, host({ blobs: blobs(), onBlobError }));
    expect(onBlobError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }), "c1's page");
    expect(out).toMatchObject({ page: null, pages: 1, card: { page: "/home/me/plan.html" } });
    spy.mockRestore();
  });
});

describe("projectItem", () => {
  const tool = (result: string): ThreadItem => ({ kind: "tool", id: "t1", name: "Bash", summary: "ls", result, at: 1000 });

  it("keeps a short item whole, redacted and scrubbed, at its own time", async () => {
    const out = await projectItem(4, { kind: "assistant", text: `x\u0000 ${KEY}`, at: 1000 }, host());
    expect(out.output).toBeUndefined();
    expect(out.item).toMatchObject({ seq: 4, kind: "assistant", at: new Date(1000).toISOString() });
    expect(JSON.stringify(out.item)).not.toContain(KEY);
    expect(JSON.stringify(out.item)).not.toContain("\\u0000");
  });

  it("never carries a <weft-env> block on a user item, and leaves one without it as it is", async () => {
    const block = "<weft-env>\nhost: your Mac (m1)\nfrom: weft.zip in a browser\ntime: 10:23 UTC (UTC+00:00)\n</weft-env>\n\n";
    const out = await projectItem(1, { kind: "user", text: `${block}ship it`, at: 1000 }, host());
    expect(out.item.item).toMatchObject({ kind: "user", text: "ship it" });
    const plain = await projectItem(2, { kind: "user", text: "just this", at: 1000 }, host());
    expect(plain.item.item).toMatchObject({ kind: "user", text: "just this" });
  });

  it("cuts a long tool result out to a redacted output row", async () => {
    const result = `${KEY} `.repeat(TOOL_RESULT_INLINE_MAX);
    const out = await projectItem(0, tool(result), host());
    expect(out.item.item).toMatchObject({ resultBytes: result.length });
    expect(out.output).toMatchObject({ tool_id: "t1", bytes: result.length });
    expect(out.output?.result).not.toContain(KEY);
  });

  it("rewrites local paths through the blob store", async () => {
    const out = await projectItem(0, tool("ok"), host({ blobs: blobs({ rewriteItem: (item) => Promise.resolve({ ...item, summary: REF } as ThreadItem) }) }));
    expect(out.item.item).toMatchObject({ summary: REF });
  });

  it("keeps the item when a rewrite fails and the host logs it", async () => {
    const onBlobError = vi.fn();
    const out = await projectItem(0, tool("ok"), host({ onBlobError, blobs: blobs({ rewriteItem: () => Promise.reject(new Error("offline")) }) }));
    expect(out.item.item).toMatchObject({ summary: "ls" });
    expect(onBlobError).toHaveBeenCalledWith(expect.any(Error), "a file");
  });

  it("throws a failed rewrite for a host that doesn't log", async () => {
    await expect(projectItem(0, tool("ok"), host({ blobs: blobs({ rewriteItem: () => Promise.reject(new Error("offline")) }) }))).rejects.toThrow("offline");
  });
});

describe("publishes", () => {
  it("drops the copilot only for a host that doesn't publish it", () => {
    expect(publishes(card({ role: "copilot" }), { copilot: true })).toBe(true);
    expect(publishes(card({ role: "copilot" }), { copilot: false })).toBe(false);
    expect(publishes(card(), { copilot: false })).toBe(true);
  });
});

describe("lastPerKey", () => {
  it("keeps the last row for each key, in first-seen order", () => {
    expect(lastPerKey([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }], (r) => r.k)).toEqual([{ k: "a", v: 3 }, { k: "b", v: 2 }]);
  });
});
