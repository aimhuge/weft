// A worker holding a key grant seals what it publishes; the desktop board opens it on this Mac's own server with main's
// keys (lib/worker-board-open.ts), and draws the 🔒 stand-ins for what main holds no key for.
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardRow, fakeClient, workerRow } from "./worker-board.harness";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
vi.mock("./cloud-sync", () => ({ syncOrgId: () => Promise.resolve("org-1") }));
const shell = vi.fn<(route: string, body: unknown) => Promise<unknown>>();
vi.mock("./browser-shell", () => ({ shell: (route: string, body: unknown) => shell(route, body) }));
vi.mock("./blob-urls", () => ({ resolveBlobUrls: (_c: unknown, _o: string, refs: string[]) => Promise.resolve(Object.fromEntries(refs.map((r) => [r, `https://sb.test/${r.slice(-4)}`]))) }));

const { readWorkerBoard, workerPage, workerThreadPage, workerToolOutput } = await import("./worker-board");
const { forgetMacRing, macRing, MAX_INLINE_BYTES, openCardRows, openItemRows, openOutput, openPageAssets, openPictureUrls } = await import("./worker-board-open");
const { sodium } = await import("./sodium");
const { aadFor, blobAad, sealBytes, sealCardRow, sealJson, SEALED_TEXT } = await import("./sync-seal");
const { SEALED_PAGE_HTML } = await import("./blob-seal");

const KEY = { version: 2, key: Buffer.alloc(32, 9).toString("base64") };
const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  forgetMacRing();
  shell.mockResolvedValue({ keys: [KEY, { version: "x", key: 1 }] });
});

describe("macRing", () => {
  it("asks main for every version once a minute, and is empty with no desktop shell", async () => {
    expect([...(await macRing("org-1", 0))]).toEqual([[2, KEY.key]]);
    await macRing("org-1", 30_000);
    expect(shell).toHaveBeenCalledTimes(1);
    shell.mockRejectedValue(new Error("no shell"));
    expect((await macRing("org-1", 61_000)).size).toBe(0);
    shell.mockResolvedValue({});
    expect((await macRing("org-2", 0)).size).toBe(0);
  });
});

describe("the desktop board's reads of a sealed worker", () => {
  it("opens a sealed card, and never asks main when nothing is sealed", async () => {
    const s = await sodium();
    const plain = cardRow();
    const sealed = sealCardRow(s, { ...cardRow(), org_id: "org-1", card_id: "c-sealed", card: { ...cardRow().card, id: "c-sealed", title: "Secret" } } as never, KEY);
    const { client } = fakeClient({ workers: [workerRow()], folderRows: [{ id: "w1", folders: [] }], cards: [plain, sealed] });
    const board = await readWorkerBoard(client, Date.now(), { read: () => Promise.resolve({ known: new Set<string>(), present: new Map() }) });
    expect(board.cards.map((c) => c.title)).toContain("Secret");
    const rows = [plain];
    expect(await openCardRows("org-1", rows)).toBe(rows);
    expect(shell).toHaveBeenCalledTimes(1);
  });

  it("opens a sealed page of the thread, and a long tool result", async () => {
    const s = await sodium();
    const item = { kind: "assistant", text: "hidden", at: 1 };
    const { client } = fakeClient({ items: [{ card_id: "c1", seq: 0, item: sealJson(s, item, KEY, aadFor("org-1", "c1", "item:0")), at: "2026-11-03T00:00:00Z" }] });
    expect((await workerThreadPage("c1", undefined, client))?.items).toEqual([item]);
    const output = JSON.stringify(sealJson(s, "the whole thing", KEY, aadFor("org-1", "c1", "tool:t1")));
    expect(await workerToolOutput("c1", "t1", fakeClient({ toolOutput: { result: output } }).client)).toBe("the whole thing");
    expect(await openOutput("org-1", "c1", "t1", "plain")).toBe("plain");
    const rows = [{ card_id: "c1", seq: 0, item }];
    expect(await openItemRows("org-1", rows)).toBe(rows);
    const noAt = await openItemRows("org-1", [{ card_id: "c1", seq: 0, item: sealJson(s, item, { version: 5, key: KEY.key }, aadFor("org-1", "c1", "item:0")) }]);
    expect(noAt[0]!.item).toEqual({ kind: "assistant", text: SEALED_TEXT, at: 0 });
  });
});

describe("a worker's sealed page", () => {
  const storage = (files: Record<string, { bytes: Uint8Array; type: string }>) => {
    const download = vi.fn((p: string) => {
      const f = files[p.split("/")[1]!];
      return Promise.resolve(f ? { data: new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.type }), error: null } : { data: null, error: { message: "no" } });
    });
    return { auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u" } } } }) }, storage: { from: () => ({ download }) } } as never;
  };

  it("opens the page, inlines its sealed assets, signs its plain ones, and draws 🔒 for one it can't open", async () => {
    const s = await sodium();
    const pic = new TextEncoder().encode("png");
    const big = new Uint8Array(MAX_INLINE_BYTES + 1);
    const plainPic = new TextEncoder().encode("plain png");
    const html = new TextEncoder().encode(`<!doctype html><img src="blob:sha256:${sha(pic)}"><img src="blob:sha256:${sha(plainPic)}"><img src="blob:sha256:${sha(big)}"><img src="blob:sha256:${"e".repeat(64)}">`);
    const seal = (b: Uint8Array, k = KEY) => sealBytes(s, b, k, blobAad("org-1", sha(b)));
    const files = {
      [sha(html)]: { bytes: seal(html), type: "text/plain" },
      [sha(pic)]: { bytes: seal(pic), type: "image/png" },
      [sha(plainPic)]: { bytes: plainPic, type: "image/png" },
      [sha(big)]: { bytes: seal(big), type: "image/png" },
      ["f".repeat(64)]: { bytes: seal(pic, { version: 7, key: KEY.key }), type: "text/html" },
    };
    const client = storage(files);
    const got = await workerPage(sha(html), client);
    expect(got?.type).toBe("text/html; charset=utf-8");
    const body = got?.body as string;
    expect(body).toContain(`data:image/png;base64,${Buffer.from(pic).toString("base64")}`);
    expect(body).toContain(`https://sb.test/${sha(plainPic).slice(-4)}`);
    expect(body).toContain(`blob:sha256:${sha(big)}`);
    expect(body).toContain(`blob:sha256:${"e".repeat(64)}`);
    expect(await workerPage("f".repeat(64), client)).toEqual({ type: "text/html; charset=utf-8", body: SEALED_PAGE_HTML });
    const file = await workerPage(sha(pic), client);
    expect(file?.type).toBe("image/png");
    expect(await openPageAssets(client, "org-1", "no refs")).toBe("no refs");
    expect(await openPageAssets(client, "org-1", `blob:sha256:${sha(pic)}`)).toMatch(/^data:image\/png/);
  });
});

describe("openPictureUrls", () => {
  it("keeps at most a couple of hundred pictures, and types one the store didn't name", async () => {
    const s = await sodium();
    const pics = Array.from({ length: 201 }, (_, i) => new TextEncoder().encode(`pic ${i}`));
    const files = Object.fromEntries(pics.map((p) => [sha(p), sealBytes(s, p, KEY, blobAad("org-1", sha(p)))]));
    const download = vi.fn((path: string) => Promise.resolve({ data: new Blob([files[path.split("/")[1]!] as Uint8Array<ArrayBuffer>]), error: null }));
    const client = { storage: { from: () => ({ download }) } } as never;
    const urls = Object.fromEntries(pics.map((p) => [`blob:sha256:${sha(p)}`, "signed"]));
    const out = await openPictureUrls(client, "org-1", urls);
    expect(Object.values(out).every((u) => u.startsWith("data:application/octet-stream;base64,"))).toBe(true);
  });
});
