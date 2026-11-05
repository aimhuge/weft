// Golden rows for both publish paths (docs/architecture/project-hosts.md, H5a): a Mac's flush (lib/cloud-sync-upload.ts)
// and a Weft Worker's publisher (lib/worker-publish.ts) over one set of cards and items. The snapshots were taken
// before the two paths moved onto lib/card-rows.ts, so a change to what either sends shows up here.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobRef, BlobStore, OutboxEntry } from "./cloud-sync-types";
import type { Card, ThreadItem } from "./types";

const cards = new Map<string, Card>();
const threads = new Map<string, ThreadItem[]>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  getThread: (id: string) => threads.get(id) ?? [],
  listCards: () => [...cards.values()],
  DATA_DIR: "/tmp/weft-golden",
}));
vi.mock("./device-id", () => ({ deviceId: () => "mac-device" }));
vi.mock("./cloud-outbox", () => ({ replaceOutboxHead: () => {} }));
// Files "exist" when they sit under /home/me, so a page or a thumb resolves without touching the disk.
vi.mock("./blob-paths", () => ({
  resolveLocalPath: (p: string) => (p.startsWith("/home/me/") ? p : null),
  resolvePage: (raw: string) => {
    const [file = "", hash] = raw.split("#");
    return file.startsWith("/home/me/") ? { local: file, hash: hash ? `#${hash}` : "" } : null;
  },
}));
vi.mock("./attachments", () => ({ attachmentFile: (name: string) => `/home/me/.weft/attachments/${name}` }));

// Built at run time so the pre-commit secret scan doesn't take the fixture for a real key.
const KEY = ["ghp", "_", "Zx81Qa7Lm2Pw9Rt4Vb6Nc3Hd5Kf0Gj8Ys1Ue"].join("");
const ref = (what: string): BlobRef => `blob:sha256:${createHash("sha256").update(what).digest("hex")}`;
const LOCAL = /\/home\/me\/[\w./-]+\.(?:png|html)/g;

const blobs: BlobStore = {
  refFor: (p) => Promise.resolve(ref(p)),
  upload: (p) => Promise.resolve(ref(p)),
  uploadPage: (p) => Promise.resolve(ref(`page:${p}`)),
  rewriteItem: (item) => Promise.resolve(JSON.parse(JSON.stringify(item).replace(LOCAL, (p) => ref(p))) as ThreadItem),
};

const base = (id: string, over: Partial<Card> = {}): Card => ({
  id,
  title: id,
  prompt: "do it",
  cwd: "/home/me/dev/app",
  backend: "claude",
  permissionMode: "default",
  column: "review",
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

const at = (n: number) => Date.parse("2026-11-01T10:00:00.000Z") + n * 1000;
const long = (fill: string) => `${fill}\n`.repeat(Math.ceil(2100 / (fill.length + 1)));

// The representative set: plain, secrets, Postgres-hostile text, pages and thumbs of each kind, long and short tool results.
function fixtures() {
  cards.clear();
  threads.clear();
  const add = (card: Card, items: ThreadItem[] = []) => (cards.set(card.id, card), threads.set(card.id, items));
  add(base("plain"), [
    { kind: "user", text: "make it dark", at: at(0) },
    { kind: "assistant", text: "On it.", at: at(1) },
    { kind: "result", text: "done", at: at(2) } as ThreadItem,
  ]);
  add(base("secrets", { title: `deploy with ${KEY}`, prompt: `token=${KEY}`, pending: { input: { command: `curl -H "Authorization: Bearer ${KEY}"` } } } as unknown as Partial<Card>), [
    { kind: "assistant", text: `I found ${KEY} in .env`, at: at(3) },
    { kind: "tool", id: "toolu_short", name: "Bash", summary: "env", result: `GITHUB_TOKEN=${KEY}`, at: at(4) },
    { kind: "tool", id: "toolu_long", name: "Bash", summary: "cat log", result: long(`line with ${KEY}`), at: at(5) },
  ]);
  add(base("hostile", { title: "bad\u0000title \ud800 here" }), [
    { kind: "tool", id: "toolu_nul", name: "Bash", summary: "tty", result: long("out\u0000put \udc00"), at: at(6) },
    { kind: "assistant", text: "nul\u0000 and \ud83d", at: at(7) },
  ]);
  add(base("paged", { page: "/home/me/.weft/show/plan.html#step-2", pages: 3, thumb: "/api/attachments/cap-1.png" }), [
    { kind: "tool", id: "toolu_open", name: "mcp__browser__open_url", summary: "file:///home/me/.weft/show/plan.html", at: at(8) },
    { kind: "assistant", text: "![chart](/home/me/dev/app/chart.png)", at: at(9) },
  ]);
  add(base("site", { page: "https://example.com/docs", pages: 1, thumb: "/home/me/.weft/attachments/cap-2.png" }));
  add(base("localhost", { page: "http://localhost:3000/", pages: 2, thumb: "/api/attachments/cap-3.png" }));
  add(base("nopage", { page: "   ", thumb: "https://example.com/t.png" }));
}

function fakeClient() {
  const sent: Record<string, unknown[]> = {};
  const client = {
    from: (table: string) => ({
      upsert: (rows: unknown[]) => ((sent[table] ??= []).push(...rows), Promise.resolve({ error: null })),
    }),
  };
  return { client: client as never, sent };
}

const pendingFor = (ids: string[]): OutboxEntry[] =>
  ids.flatMap((id) => [{ op: "card" as const, cardId: id, at: 0 }, ...(threads.get(id) ?? []).map((_, seq) => ({ op: "item" as const, cardId: id, seq, at: 0 }))]);

async function macRows(sealer?: () => Promise<never>) {
  const { uploadPending } = await import("./cloud-sync-upload");
  const { client, sent } = fakeClient();
  const ctx = { blobs, now: () => at(100), sealer: sealer ?? (() => Promise.resolve(null)) };
  await uploadPending(ctx, client, "org-1", pendingFor([...cards.keys()]), () => {});
  return sent;
}

async function workerRows(pages: boolean) {
  const { createPublisher } = await import("./worker-publish");
  const calls: unknown[] = [];
  const reg = {
    putCard: (...args: unknown[]) => (calls.push(["putCard", ...args]), Promise.resolve()),
    putItems: (...args: unknown[]) => (calls.push(["putItems", ...args]), Promise.resolve()),
  };
  const source = { getCard: (id: string) => cards.get(id), getThread: (id: string) => threads.get(id) ?? [] };
  const p = createPublisher(reg, source, () => {}, pages ? { blobs: blobs as never, orgId: "org-1" } : undefined);
  for (const id of cards.keys()) p.track(id);
  await p.flush();
  return calls;
}

beforeEach(fixtures);

describe("golden rows", () => {
  it("a Mac's flush, plain", async () => {
    expect(await macRows()).toMatchSnapshot();
  });

  it("a Mac's flush hands the sealer the finished rows", async () => {
    const seen: unknown[] = [];
    const mark = (slot: string) => (row: object) => (seen.push([slot, row]), { ...row, sealed: slot });
    const sealer = () => Promise.resolve({ card: mark("card"), item: mark("item"), tool: mark("tool"), blob: () => null } as never);
    const sent = await macRows(sealer);
    expect(seen).toMatchSnapshot();
    expect(Object.values(sent).flat().every((row) => (row as { sealed?: string }).sealed)).toBe(true);
  });

  it("a worker's publisher, with pages", async () => {
    expect(await workerRows(true)).toMatchSnapshot();
  });

  it("a worker's publisher, without pages", async () => {
    expect(await workerRows(false)).toMatchSnapshot();
  });
});
