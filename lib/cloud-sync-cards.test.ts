import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";
import type { BlobStore, OutboxEntry } from "./cloud-sync-types";

const cards = new Map<string, Card>();
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sync-cards-"));
vi.mock("./store", () => ({ getCard: (id: string) => cards.get(id), DATA_DIR: DATA }));
vi.mock("./device-id", () => ({ deviceId: () => "dev1" }));

const { cardRows, withUploadedPage, withUploadedThumbs } = await import("./cloud-sync-cards");

const REF = `blob:sha256:${"a".repeat(64)}`;
const upload = vi.fn((file: string) => Promise.resolve(fs.existsSync(file) ? (REF as `blob:sha256:${string}`) : null));
const blobs: BlobStore = { refFor: vi.fn(() => Promise.resolve(null)), upload, rewriteItem: (item) => Promise.resolve(item) };

function card(id: string, over: Partial<Card> = {}): Card {
  const c: Card = { id, title: id, prompt: "", cwd: "/sync", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over };
  cards.set(id, c);
  return c;
}
const attachment = (name: string) => {
  fs.mkdirSync(path.join(DATA, "attachments"), { recursive: true });
  fs.writeFileSync(path.join(DATA, "attachments", name), "jpg");
  return path.join(DATA, "attachments", name);
};

beforeEach(() => {
  cards.clear();
  upload.mockClear();
});
afterAll(() => fs.rmSync(DATA, { recursive: true, force: true }));

describe("cardRows", () => {
  it("builds one row per live card the batch touches, skipping deletes and gone cards", async () => {
    const a = card("a");
    const pending: OutboxEntry[] = [
      { op: "card", cardId: "a", at: 1 },
      { op: "item", cardId: "a", seq: 0, at: 1 },
      { op: "item", cardId: "gone", seq: 0, at: 1 },
      { op: "card_deleted", cardId: "b", at: 1 },
    ];
    expect(await cardRows(blobs, "o1", pending, 5000)).toEqual([
      { org_id: "o1", card_id: "a", owner_device: "dev1", folder: "/sync", card: a, deleted: false, updated_at: new Date(5000).toISOString(), page: null, page_thumb: null, pages: 0 },
    ]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads the pane capture and puts its ref in the row's copy only", async () => {
    const file = attachment("pane-abc.jpg");
    const local = card("a", { thumb: "/api/attachments/pane-abc.jpg" });
    const [row] = await cardRows(blobs, "o1", [{ op: "card", cardId: "a", at: 1 }], 1);
    expect(upload).toHaveBeenCalledWith(file, "o1");
    expect(row?.card.thumb).toBe(REF);
    expect(local.thumb).toBe("/api/attachments/pane-abc.jpg");
  });
});

describe("withUploadedThumbs", () => {
  const row = (thumb?: string) => ({ org_id: "o1", card_id: "a", owner_device: "d", folder: "/f", card: card("a", { thumb }), deleted: false, updated_at: "" });

  it("uploads a local file under home, by path", async () => {
    // The test setup points HOME at a temp folder that may not exist yet.
    fs.mkdirSync(os.homedir(), { recursive: true });
    const dir = fs.mkdtempSync(path.join(os.homedir(), ".weft-sync-cards-test-"));
    try {
      const file = path.join(dir, "shot.png");
      fs.writeFileSync(file, "png");
      const [out] = await withUploadedThumbs([row(file)], blobs, "o1");
      expect(out?.card.thumb).toBe(REF);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves no thumb, a web URL, a ref, a missing attachment and an unsafe path as they were", async () => {
    for (const thumb of [undefined, "https://x.test/a.png", REF, "/api/attachments/missing.jpg", "/etc/passwd"]) {
      const r = row(thumb);
      expect((await withUploadedThumbs([r], blobs, "o1"))[0]).toBe(r);
    }
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps the thumb when the upload gives no ref", async () => {
    attachment("p.jpg");
    upload.mockResolvedValueOnce(null);
    const r = row("/api/attachments/p.jpg");
    expect((await withUploadedThumbs([r], blobs, "o1"))[0]).toBe(r);
  });
});

describe("withUploadedPage", () => {
  const row = (over: Partial<Card>) => ({ org_id: "o1", card_id: "a", owner_device: "d", folder: "/f", card: card("a", over), deleted: false, updated_at: "" });

  it("uploads a ~/.weft/show page as a blob ref, keeping its anchor, in the row and its copy of the card", async () => {
    fs.mkdirSync(os.homedir(), { recursive: true });
    const dir = fs.mkdtempSync(path.join(os.homedir(), ".weft-sync-page-test-"));
    try {
      const file = path.join(dir, "plan.html");
      fs.writeFileSync(file, "<html></html>");
      const local = row({ page: `file://${file}#step-2`, pages: 3, thumb: REF });
      const out = await withUploadedPage(local, blobs, "o1");
      expect(upload).toHaveBeenCalledWith(file, "o1");
      expect(out).toMatchObject({ page: `${REF}#step-2`, page_thumb: null, pages: 3 });
      expect(out.card.page).toBe(`${REF}#step-2`);
      expect(local.card.page).toBe(`file://${file}#step-2`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uploads the page through the store's page upload when it has one, so its images go up too", async () => {
    fs.mkdirSync(os.homedir(), { recursive: true });
    const dir = fs.mkdtempSync(path.join(os.homedir(), ".weft-sync-page-test-"));
    try {
      const file = path.join(dir, "tour.html");
      fs.writeFileSync(file, "<html></html>");
      const uploadPage = vi.fn(() => Promise.resolve(REF as `blob:sha256:${string}`));
      const out = await withUploadedPage(row({ page: file }), { ...blobs, uploadPage }, "o1");
      expect(uploadPage).toHaveBeenCalledWith(file, "o1");
      expect(upload).not.toHaveBeenCalled();
      expect(out.page).toBe(REF);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the page's URL when its upload gives no ref", async () => {
    fs.mkdirSync(os.homedir(), { recursive: true });
    const dir = fs.mkdtempSync(path.join(os.homedir(), ".weft-sync-page-test-"));
    try {
      const file = path.join(dir, "a.html");
      fs.writeFileSync(file, "<html></html>");
      upload.mockResolvedValueOnce(null);
      expect(await withUploadedPage(row({ page: file, thumb: REF }), blobs, "o1")).toMatchObject({ page: file, page_thumb: REF });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a public site's URL with no capture", async () => {
    const out = await withUploadedPage(row({ page: "https://vercel.com/dash", pages: 1, thumb: REF }), blobs, "o1");
    expect(out).toMatchObject({ page: "https://vercel.com/dash", page_thumb: null, pages: 1 });
  });

  it("keeps a localhost page's URL and points at the pane capture", async () => {
    const out = await withUploadedPage(row({ page: "http://localhost:3000/login", pages: 2, thumb: REF }), blobs, "o1");
    expect(out).toMatchObject({ page: "http://localhost:3000/login", page_thumb: REF, pages: 2 });
    expect(upload).not.toHaveBeenCalled();
  });

  it("falls back to the capture for a file it can't upload, and sends nulls with no page", async () => {
    expect(await withUploadedPage(row({ page: "file:///etc/hosts", thumb: REF }), blobs, "o1")).toMatchObject({ page: "file:///etc/hosts", page_thumb: REF, pages: 0 });
    expect(await withUploadedPage(row({ page: "file:///etc/hosts" }), blobs, "o1")).toMatchObject({ page_thumb: null });
    expect(await withUploadedPage(row({}), blobs, "o1")).toMatchObject({ page: null, page_thumb: null, pages: 0 });
  });
});
