import { beforeAll, describe, expect, it } from "vitest";
import type { CloudCardRow, CloudThreadItemRow, CloudToolOutputRow } from "./cloud-sync-types";
import { sodium, b64, type Sodium } from "./sodium";
import {
  aadFor, blobAad, isSealed, isSealedBytes, openBytes, openCard, openItem, openJson, openToolResult, sealBytes, sealCardRow,
  sealItemRow, sealJson, sealToolRow, SEALED_TEXT, SEALED_TITLE, type SyncKey,
} from "./sync-seal";
import type { Card } from "./types";

let s: Sodium;
let key: SyncKey;
let ring: Map<number, string>;
beforeAll(async () => {
  s = await sodium();
  key = { version: 2, key: b64(s, s.crypto_aead_xchacha20poly1305_ietf_keygen()) };
  ring = new Map([[2, key.key]]);
});

const ORG = "org-1";
const itemRow = (seq = 3): CloudThreadItemRow => ({ org_id: ORG, card_id: "c1", seq, kind: "user", item: { kind: "user", text: "deploy it", at: 5 }, at: "2026-10-29T00:00:00.000Z" });

describe("envelopes", () => {
  it("round-trips and says what it is", () => {
    const sealed = sealJson(s, { a: 1 }, key, "x");
    expect(isSealed(sealed)).toBe(true);
    expect(sealed.v).toBe(2);
    expect(openJson(s, sealed, ring, "x")).toEqual({ a: 1 });
  });
  it("won't open under other associated data, another key, or a missing version", () => {
    const sealed = sealJson(s, "hi", key, aadFor(ORG, "c1", "item:1"));
    expect(openJson(s, sealed, ring, aadFor(ORG, "c1", "item:2"))).toBeUndefined();
    expect(openJson(s, sealed, new Map([[2, b64(s, s.crypto_aead_xchacha20poly1305_ietf_keygen())]]), aadFor(ORG, "c1", "item:1"))).toBeUndefined();
    expect(openJson(s, sealed, new Map(), aadFor(ORG, "c1", "item:1"))).toBeUndefined();
  });
  it("isSealed refuses lookalikes", () => {
    for (const v of [null, "x", { $sealed: 2, v: 1, n: "", c: "" }, { $sealed: 1, v: "1", n: "", c: "" }]) expect(isSealed(v)).toBe(false);
  });
});

describe("items", () => {
  it("seals the body and keeps ids, kind and time plain", () => {
    const sealed = sealItemRow(s, itemRow(), key);
    expect(sealed).toMatchObject({ org_id: ORG, card_id: "c1", seq: 3, kind: "user", at: itemRow().at });
    expect(JSON.stringify(sealed.item)).not.toContain("deploy");
    expect(sealItemRow(s, sealed, key)).toBe(sealed);
    expect(openItem(s, sealed, ring)).toEqual(itemRow().item);
  });
  it("passes a plain row through and stands in for one it can't open", () => {
    expect(openItem(s, itemRow(), ring)).toEqual(itemRow().item);
    const sealed = sealItemRow(s, itemRow(), key);
    expect(openItem(s, sealed, new Map())).toEqual({ kind: "assistant", text: SEALED_TEXT, at: Date.parse(itemRow().at) });
    expect(openItem(s, { ...sealed, at: "nope" }, new Map())).toMatchObject({ at: 0 });
  });
  it("won't open an item the server moved to another seq", () => {
    const sealed = sealItemRow(s, itemRow(3), key);
    expect(openItem(s, { ...sealed, seq: 4 }, ring)).toMatchObject({ text: SEALED_TEXT });
  });
});

describe("cards", () => {
  const card = { id: "c1", title: "Fix login", prompt: "the secret plan", column: "running", cwd: "/w", lastLine: "ok", tags: ["bug"] } as unknown as Card;
  const row: CloudCardRow = { org_id: ORG, card_id: "c1", owner_device: "d", folder: "/w", card, deleted: false, updated_at: "t" };
  it("seals what a person or thread wrote and keeps the rest", () => {
    const sealed = sealCardRow(s, row, key);
    const c = sealed.card as unknown as Record<string, unknown>;
    expect(c.title).toBe(SEALED_TITLE);
    expect(c.prompt).toBe("");
    expect(c.lastLine).toBeUndefined();
    expect(c).toMatchObject({ column: "running", tags: ["bug"] });
    expect(JSON.stringify(c)).not.toContain("secret plan");
    expect(sealCardRow(s, sealed, key)).toBe(sealed);
    expect(openCard(s, sealed, ring)).toEqual(card);
  });
  it("passes plain cards and keeps the 🔒 title without a key", () => {
    expect(openCard(s, row, ring)).toBe(card);
    expect(openCard(s, sealCardRow(s, row, key), new Map()).title).toBe(SEALED_TITLE);
  });
});

describe("tool outputs", () => {
  const row: CloudToolOutputRow = { org_id: ORG, card_id: "c1", tool_id: "t1", result: "x".repeat(3000), bytes: 3000 };
  it("seals the result as JSON text", () => {
    const sealed = sealToolRow(s, row, key);
    expect(sealed.result.startsWith('{"$sealed":1')).toBe(true);
    expect(sealed.bytes).toBe(3000);
    expect(openToolResult(s, sealed, ring)).toBe(row.result);
    expect(openToolResult(s, sealed, new Map())).toBe(SEALED_TEXT);
    expect(openToolResult(s, { ...sealed, tool_id: "t2" }, ring)).toBe(SEALED_TEXT);
  });
  it("leaves plain and lookalike results alone", () => {
    expect(openToolResult(s, row, ring)).toBe(row.result);
    expect(openToolResult(s, { ...row, result: '{"$sealed":1 broken' }, ring)).toBe('{"$sealed":1 broken');
    expect(openToolResult(s, { ...row, result: '{"$sealed":1}' }, ring)).toBe('{"$sealed":1}');
  });
});

describe("blobs", () => {
  it("seals bytes with the version up front", () => {
    const plain = s.from_string("<html>hi</html>");
    const sealed = sealBytes(s, plain, key, blobAad(ORG, "abc"));
    expect(isSealedBytes(sealed)).toBe(true);
    expect(isSealedBytes(plain)).toBe(false);
    expect(s.to_string(openBytes(s, sealed, ring, blobAad(ORG, "abc"))!)).toBe("<html>hi</html>");
    expect(openBytes(s, plain, ring, "x")).toBe(plain);
    expect(openBytes(s, sealed, new Map(), blobAad(ORG, "abc"))).toBeUndefined();
    expect(openBytes(s, sealed, ring, blobAad(ORG, "abd"))).toBeUndefined();
  });
});
