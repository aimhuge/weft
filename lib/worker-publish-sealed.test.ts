import { describe, expect, it, vi } from "vitest";
import { makeSealer, type Sealer } from "./sync-seal-upload";
import { sodium } from "./sodium";
import { isSealed, openCard, openItem, openToolResult } from "./sync-seal";
import type { Card, ThreadItem } from "./types";
import type { BlobSeal } from "./cloud-sync-types";
import { createPublisher, type PublishedPages } from "./worker-publish";
import { newSyncKey } from "./worker-key-grant.harness";
import type { ItemRow, OutputRow } from "./worker-registry";

// A worker holding a key grant seals what it publishes, as a Mac's outbox does (lib/worker-sealing.ts).
const ORG = "org-1";
const KEY = { version: 3, key: newSyncKey() };
const ring = new Map([[3, KEY.key]]);
const card = { id: "card-1", title: "Secret plan", prompt: "ship it", cwd: "/srv/work/ling", column: "run" } as unknown as Card;
const long = "x".repeat(70_000);
const thread: ThreadItem[] = [
  { kind: "assistant", text: "hello", at: 1 },
  { kind: "tool", id: "t1", name: "Bash", summary: "ls", result: long, at: 2 },
];

function setup(sealer: () => Sealer | null | "hold") {
  const putCard = vi.fn<(id: string, folder: string, card: unknown, deleted?: boolean) => Promise<void>>(() => Promise.resolve());
  const putItems = vi.fn<(id: string, items: ItemRow[], outputs: OutputRow[], fromSeq: number | null) => Promise<void>>(() => Promise.resolve());
  const seals: (BlobSeal | undefined)[] = [];
  const blobs: PublishedPages["blobs"] = {
    refFor: vi.fn(() => Promise.resolve(null)),
    upload: vi.fn(() => Promise.resolve(null)),
    uploadPage: vi.fn(() => Promise.resolve(null)),
    rewriteItem: vi.fn((item: ThreadItem, _org: string, seal?: BlobSeal) => {
      seals.push(seal);
      return Promise.resolve(item);
    }),
  };
  const log = vi.fn();
  const lines: unknown[] = [];
  const p = createPublisher({ putCard, putItems }, { getCard: () => card, getThread: () => thread }, log, { blobs, orgId: ORG, sealer });
  p.mirror((e) => lines.push(e));
  p.track("card-1");
  return { p, putCard, putItems, seals, log, lines };
}

describe("a worker's sealed publishing", () => {
  it("seals the card, its items, its long tool results and the files they name; the session line still hears them plain", async () => {
    const s = await sodium();
    const { p, putCard, putItems, seals, lines } = setup(() => makeSealer(s, KEY, () => false));
    await p.flush();
    const row = putCard.mock.calls[0]![2] as Card;
    expect(row.title).toBe("🔒");
    expect(openCard(s, { org_id: ORG, card_id: "card-1", card: row }, ring).prompt).toBe("ship it");
    const [, items, outputs] = putItems.mock.calls[0]!;
    expect(items.every((i) => isSealed(i.item))).toBe(true);
    expect(openItem(s, { org_id: ORG, card_id: "card-1", ...items[0]! } as never, ring)).toEqual(thread[0]);
    expect(openToolResult(s, { org_id: ORG, card_id: "card-1", ...outputs[0]! }, ring)).toBe(long);
    expect(seals.every((seal) => typeof seal === "function")).toBe(true);
    expect(lines.some((e) => (e as { t: string; card?: Card }).card?.title === "Secret plan")).toBe(true);
  });

  it("keeps a shared card plain", async () => {
    const s = await sodium();
    const { p, putCard, seals } = setup(() => makeSealer(s, KEY, () => true));
    await p.flush();
    expect((putCard.mock.calls[0]![2] as Card).title).toBe("Secret plan");
    expect(seals.every((seal) => seal === undefined)).toBe(true);
  });

  it("holds every row back while it sealed before and holds no key, then ships them once a key is back", async () => {
    const s = await sodium();
    let state: Sealer | null | "hold" = "hold";
    const { p, putCard, log } = setup(() => state);
    await p.flush();
    await p.flush();
    expect(putCard).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Weft Worker: not publishing: this worker sealed/));
    state = makeSealer(s, KEY, () => false);
    await p.flush();
    expect((putCard.mock.calls[0]![2] as Card).title).toBe("🔒");
  });
});
