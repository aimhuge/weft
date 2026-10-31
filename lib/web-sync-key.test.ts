// Node, not jsdom: libsodium refuses jsdom's Uint8Array (another realm). localStorage is a Map here.
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  clear: () => store.clear(),
} as unknown as Storage;
import { fakeDb } from "../electron/pairing.harness";
import { makeClaim, newPairingSecret, pairingLink } from "./pairing-link";
import { b64, sodium, type Sodium } from "./sodium";
import { sealCardRow, sealItemRow, sealToolRow, SEALED_TEXT } from "./sync-seal";
import { BROWSER_DEVICE_KEY, loadWebKeyring, openSyncedCard, openSyncedItem, openSyncedTool, pairThisBrowser, resetWebKeyring, webKeyring } from "./web-sync-key";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PAIR_ID = "11111111-2222-4333-8444-555555555555";
let s: Sodium;
let key: string;
beforeAll(async () => {
  s = await sodium();
  key = b64(s, s.crypto_aead_xchacha20poly1305_ietf_keygen());
});
afterEach(() => {
  resetWebKeyring();
  localStorage.clear();
});

const item = { org_id: ORG, card_id: "c", seq: 2, kind: "user" as const, item: { kind: "user" as const, text: "secret", at: 1 }, at: "2026-10-29T00:00:00Z" };
const asClient = (db: ReturnType<typeof fakeDb>) => db as never;

function pairedBrowser(db: ReturnType<typeof fakeDb>) {
  const box = s.crypto_box_keypair();
  localStorage.setItem(BROWSER_DEVICE_KEY, JSON.stringify({ userId: "u1", deviceId: "dev-b", boxPub: b64(s, box.publicKey), boxPriv: b64(s, box.privateKey), signPub: "", signPriv: "" }));
  db.tables.workspace_key_grants = [
    { org_id: ORG, version: 1, device_id: "dev-b", wrapped_key: b64(s, s.crypto_box_seal(s.from_base64(key, 1), box.publicKey)) },
    { org_id: ORG, version: 2, device_id: "dev-b", wrapped_key: "junk" },
  ];
}

describe("before a key is loaded", () => {
  it("passes plain rows and stands in for sealed ones", () => {
    expect(openSyncedItem(item)).toEqual(item.item);
    const sealed = sealItemRow(s, item, { version: 1, key });
    expect(openSyncedItem(sealed)).toMatchObject({ kind: "assistant", text: SEALED_TEXT });
    expect(openSyncedItem({ card_id: "c", seq: 2, item: sealed.item })).toMatchObject({ at: 0 });
    const card = { org_id: ORG, card_id: "c", card: { title: "t" } as never };
    expect(openSyncedCard(card)).toBe(card);
    expect(openSyncedTool({ org_id: ORG, card_id: "c", tool_id: "t", result: "r" })).toBe("r");
  });
});

describe("loadWebKeyring", () => {
  it("is false for a browser that isn't paired, or another account's", async () => {
    expect(await loadWebKeyring(asClient(fakeDb()), ORG, "u1")).toBe(false);
    localStorage.setItem(BROWSER_DEVICE_KEY, JSON.stringify({ userId: "u2", deviceId: "d" }));
    expect(await loadWebKeyring(asClient(fakeDb()), ORG, "u1")).toBe(false);
    localStorage.setItem(BROWSER_DEVICE_KEY, "{not json");
    expect(await loadWebKeyring(asClient(fakeDb()), ORG, "u1")).toBe(false);
  });

  it("opens this browser's grants, and then its rows", async () => {
    const db = fakeDb();
    pairedBrowser(db);
    expect(await loadWebKeyring(asClient(db), ORG, "u1")).toBe(true);
    expect([...webKeyring().keys()]).toEqual([1]);
    const sealed = sealItemRow(s, item, { version: 1, key });
    expect(openSyncedItem({ card_id: "c", seq: 2, item: sealed.item })).toEqual(item.item);
    const card = { org_id: ORG, card_id: "c", owner_device: "d", folder: "/", card: { title: "Hi", prompt: "p" } as never, deleted: false, updated_at: "t" };
    expect(openSyncedCard(sealCardRow(s, card, { version: 1, key })).card).toMatchObject({ title: "Hi" });
    expect(openSyncedCard(card)).toBe(card);
    const tool = sealToolRow(s, { org_id: ORG, card_id: "c", tool_id: "t", result: "long", bytes: 4 }, { version: 1, key });
    expect(openSyncedTool(tool)).toBe("long");
  });

  it("is false when the grants can't be read", async () => {
    const db = fakeDb();
    pairedBrowser(db);
    const failing: Record<string, unknown> = { then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "x" } }).then(r) };
    for (const m of ["select", "eq"]) failing[m] = () => failing;
    expect(await loadWebKeyring({ from: () => failing } as never, ORG, "u1")).toBe(false);
  });
});

describe("pairThisBrowser", () => {
  const link = () => pairingLink({ id: PAIR_ID, orgId: ORG, secret: newPairingSecret(s), mac: "" });
  const instant = { everyMs: 0, sleep: () => Promise.resolve() };

  it("writes a claim the Mac accepts and keeps the device once paired", async () => {
    const db = fakeDb({ phone_pairings: [{ id: PAIR_ID, status: "open" }] });
    let polls = 0;
    const url = link();
    const sleep = () => {
      if (++polls === 2) Object.assign(db.tables.phone_pairings[0]!, { status: "paired", device_id: "dev-new" });
      return Promise.resolve();
    };
    expect(await pairThisBrowser(asClient(db), url, { id: "u1", name: "Alex" }, { everyMs: 0, sleep })).toBe("paired");
    const row = db.tables.phone_pairings[0]!;
    expect(row).toMatchObject({ kind: "browser", platform: "web", name: "Alex" });
    const { checkClaim } = await import("./pairing-link");
    const { parsePairingLink } = await import("./pairing-link");
    expect(checkClaim(s, parsePairingLink(url)!, row as never)).toBeNull();
    expect(JSON.parse(localStorage.getItem(BROWSER_DEVICE_KEY)!)).toMatchObject({ userId: "u1", deviceId: "dev-new" });
    expect(makeClaim).toBeTypeOf("function");
  });

  it("says when the Mac refuses or the code runs out", async () => {
    const db = fakeDb({ phone_pairings: [{ id: PAIR_ID, status: "open" }] });
    const sleep = () => Promise.resolve(void (db.tables.phone_pairings[0]!.status = "cancelled"));
    expect(await pairThisBrowser(asClient(db), link(), { id: "u1", name: "A" }, { everyMs: 0, sleep })).toBe("refused");
    const db2 = fakeDb({ phone_pairings: [{ id: PAIR_ID, status: "open" }] });
    expect(await pairThisBrowser(asClient(db2), link(), { id: "u1", name: "A" }, { ...instant, tries: 2 })).toBe("expired");
  });

  it("refuses a broken link and names a failed claim", async () => {
    await expect(pairThisBrowser(asClient(fakeDb()), "https://weft.zip/pair", { id: "u", name: "" })).rejects.toThrow(/isn't complete/);
    const failing: Record<string, unknown> = { then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "denied" } }).then(r) };
    for (const m of ["update", "eq"]) failing[m] = () => failing;
    await expect(pairThisBrowser({ from: () => failing } as never, link(), { id: "u", name: "" }, instant)).rejects.toThrow("The claim couldn't be sent: denied");
  });
});
