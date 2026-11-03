import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { blobSealer, openBlob } from "./blob-seal";
import { sodium } from "./sodium";
import { isSealed, openCard, openItem, openToolResult, type SyncKey } from "./sync-seal";
import type { Card, ThreadItem } from "./types";
import { newSyncKey, ORG } from "./worker-key-grant.harness";
import { HELD, sealedCard, sealedItems } from "./worker-seal-rows";
import { openingReader, workerSealing } from "./worker-sealing";

const KEY: SyncKey = { version: 2, key: newSyncKey() };
const ring = new Map([[2, KEY.key]]);
const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

describe("workerSealing", () => {
  it("publishes plain with no key, holds when it sealed before, and seals with the key it holds", async () => {
    const s = await sodium();
    let state: ReturnType<Parameters<typeof workerSealing>[0]["state"]> = "plain";
    const sealing = workerSealing({ state: () => state }, s, (id) => id === "shared");
    expect(sealing.sealer()).toBeNull();
    expect(sealing.blobSeal("c1")).toBeNull();
    state = "hold";
    expect(sealing.sealer()).toBe("hold");
    expect(() => sealing.blobSeal("c1")).toThrow(HELD);
    state = { key: KEY };
    const sealer = sealing.sealer();
    expect(sealer && sealer !== "hold" ? sealer.blob("shared") : "x").toBeNull();
    const seal = sealing.blobSeal("c1");
    const bytes = new TextEncoder().encode("<html>hi</html>");
    const opened = await openBlob(s, seal!(ORG, sha(bytes), bytes), ring, ORG, sha(bytes));
    expect(opened?.sealed).toBe(true);
    // A page opened with no card still goes sealed: no card id names a shared card.
    expect(sealing.blobSeal(undefined)).toBeTypeOf("function");
  });
});

describe("sealedCard / sealedItems", () => {
  it("passes rows through with no sealer, and seals them so the Mac and web open them where they sit", async () => {
    const s = await sodium();
    const card = { id: "c1", title: "Secret plan", prompt: "do it", column: "running" } as unknown as Card;
    expect(sealedCard(null, ORG, "c1", card)).toBe(card);
    const item: ThreadItem = { kind: "assistant", text: "hello", at: 1 };
    const rows = { items: [{ seq: 0, kind: "assistant", item, at: "2026-11-03T00:00:00Z" }], outputs: [{ tool_id: "t1", result: "long", bytes: 4 }] };
    expect(sealedItems(null, ORG, "c1", rows.items, rows.outputs)).toEqual(rows);
    const sealer = workerSealing({ state: () => ({ key: KEY }) }, s, () => false).sealer();
    if (!sealer || sealer === "hold") throw new Error("no sealer");
    const sealed = sealedCard(sealer, ORG, "c1", card);
    expect(sealed.title).toBe("🔒");
    expect(openCard(s, { org_id: ORG, card_id: "c1", card: sealed }, ring).title).toBe("Secret plan");
    const out = sealedItems(sealer, ORG, "c1", rows.items, rows.outputs);
    expect(isSealed(out.items[0]!.item)).toBe(true);
    expect(openItem(s, { org_id: ORG, card_id: "c1", ...out.items[0]! } as never, ring)).toEqual(item);
    expect(openToolResult(s, { org_id: ORG, card_id: "c1", tool_id: "t1", result: out.outputs[0]!.result }, ring)).toBe("long");
    // Moved to another card, it won't open.
    expect(openCard(s, { org_id: ORG, card_id: "c2", card: sealed }, ring).title).toBe("🔒");
  });
});

describe("openingReader", () => {
  it("passes plain files, opens sealed ones, and refuses one it holds no key for", async () => {
    const s = await sodium();
    const plain = Buffer.from("plain bytes");
    const secret = new TextEncoder().encode("a picture");
    const sealed = Buffer.from(blobSealer(s, KEY)(ORG, sha(secret), secret));
    const files: Record<string, Buffer> = { [sha(plain)]: plain, [sha(secret)]: sealed };
    const log = vi.fn();
    let held = ring;
    const read = openingReader((h) => Promise.resolve(files[h] ?? null), { ring: () => held }, ORG, sodium, log);
    expect(await read("missing")).toBeNull();
    expect(await read(sha(plain))).toEqual(plain);
    expect(String(await read(sha(secret)))).toBe("a picture");
    held = new Map();
    expect(await read(sha(secret))).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/workspace key v2, which this worker doesn't hold/));
  });
});
