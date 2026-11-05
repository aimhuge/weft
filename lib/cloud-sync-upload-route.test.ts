// uploadPending with a route: a team's linked project lands in the team, the rest at home (lib/cloud-sync-route.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore, OutboxEntry } from "./cloud-sync-types";
import type { SyncRoute } from "./cloud-sync-route";
import type { Card, ThreadItem } from "./types";

const cards = new Map<string, Card>();
const threads = new Map<string, ThreadItem[]>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  getThread: (id: string) => threads.get(id) ?? [],
  listCards: () => [...cards.values()],
  get DATA_DIR() {
    return process.env.WEFT_DATA;
  },
}));

const blobs: BlobStore = {
  refFor: vi.fn(() => Promise.resolve(null)),
  upload: vi.fn(() => Promise.resolve(null)),
  rewriteItem: (item) => Promise.resolve(item),
};

// Records each write as [table, verb, filters…] and every upserted row.
function recorder() {
  const writes: string[][] = [];
  const rows: Record<string, Record<string, unknown>[]> = {};
  const chain = (log: string[]) => {
    const step = {
      eq: (k: string, v: unknown) => (log.push(`${k}=${String(v)}`), step),
      in: (k: string, v: unknown[]) => (log.push(`${k} in ${v.join(",")}`), step),
      gte: (k: string, v: unknown) => (log.push(`${k}>=${String(v)}`), step),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
    };
    return step;
  };
  const client = {
    from: (table: string) => ({
      upsert: (sent: Record<string, unknown>[]) => {
        (rows[table] ??= []).push(...sent);
        return Promise.resolve({ error: null });
      },
      update: () => {
        const log = [table, "update"];
        writes.push(log);
        return chain(log);
      },
      delete: () => {
        const log = [table, "delete"];
        writes.push(log);
        return chain(log);
      },
    }),
  };
  return { client: client as never, writes, rows };
}

const route: SyncRoute = { home: "home", orgOf: (id) => (id.startsWith("t") ? "team" : "home"), all: () => ["home", "team"] };

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cloud-route-"));
  process.env.WEFT_DATA = dir;
  cards.clear();
  threads.clear();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function addCard(id: string, n: number) {
  cards.set(id, { id, title: id, prompt: "", cwd: "/sync", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0 });
  threads.set(id, Array.from({ length: n }, (_, i) => ({ kind: "assistant", text: `m${i}`, at: 1000 + i })));
}

async function upload(pending: OutboxEntry[], client: never, sealer?: (org: string) => Promise<null>) {
  const { appendOutbox, readOutbox } = await import("./cloud-outbox");
  const { uploadPending } = await import("./cloud-sync-upload");
  appendOutbox(pending);
  await uploadPending({ blobs, now: () => 5000, ...(sealer ? { sealer } : {}) }, client, route, pending, () => {});
  return readOutbox();
}

describe("uploadPending with a route", () => {
  it("files each card and its items under its own workspace, and leaves the team card's home copy", async () => {
    addCard("t1", 2);
    addCard("h1", 1);
    const { client, rows, writes } = recorder();
    const pending: OutboxEntry[] = [
      { op: "card", cardId: "t1", at: 1 },
      { op: "card", cardId: "h1", at: 1 },
      { op: "item", cardId: "t1", seq: 0, at: 1 },
      { op: "item", cardId: "h1", seq: 0, at: 1 },
      { op: "item", cardId: "t1", seq: 1, at: 1 },
    ];
    const left = await upload(pending, client);
    expect(rows.cloud_cards!.map((r) => [r.card_id, r.org_id])).toEqual([["t1", "team"], ["h1", "home"]]);
    expect(rows.cloud_thread_items!.map((r) => [r.card_id, r.seq, r.org_id])).toEqual([["t1", 0, "team"], ["t1", 1, "team"], ["h1", 0, "home"]]);
    expect(writes).toEqual([["cloud_cards", "update", "org_id=home", "card_id in t1", "deleted=false"]]);
    expect(left).toEqual([]);
  });

  it("marks a deleted card gone in every workspace, and truncates in the card's own", async () => {
    addCard("t1", 1);
    const { client, writes } = recorder();
    await upload([{ op: "card_deleted", cardId: "x", at: 1 }, { op: "truncate", cardId: "t1", seq: 3, at: 1 }], client);
    expect(writes).toEqual([
      // The truncate touches t1, so its row goes up first (cardRows takes every live card a batch touches).
      ["cloud_cards", "update", "org_id=home", "card_id in t1", "deleted=false"],
      ["cloud_cards", "update", "org_id=home", "card_id=x"],
      ["cloud_cards", "update", "org_id=team", "card_id=x"],
      ["cloud_thread_items", "delete", "org_id=team", "card_id=t1", "seq>=3"],
    ]);
  });

  it("asks each workspace's sealer once a flush", async () => {
    addCard("t1", 1);
    addCard("t2", 1);
    addCard("h1", 1);
    const sealer = vi.fn<(org: string) => Promise<null>>(() => Promise.resolve(null));
    const pending: OutboxEntry[] = ["t1", "t2", "h1"].flatMap((id) => [{ op: "card", cardId: id, at: 1 }, { op: "item", cardId: id, seq: 0, at: 1 }]);
    await upload(pending, recorder().client, sealer);
    expect(sealer.mock.calls.map((c) => c[0]).sort()).toEqual(["home", "team"]);
  });
});
