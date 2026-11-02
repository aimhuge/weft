// Node, not jsdom: libsodium refuses jsdom's Uint8Array (another realm). localStorage is a Map here.
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  clear: () => store.clear(),
} as unknown as Storage;
import { fakeDb } from "../electron/pairing.harness";
import { checkClaim, newPairingSecret, pairingLink, parsePairingLink } from "./pairing-link";
import { sodium, type Sodium } from "./sodium";
import { BROWSER_DEVICE_KEY, browserPasskey, pairThisBrowser, resetWebKeyring } from "./web-sync-key";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PAIR_ID = "11111111-2222-4333-8444-555555555555";
let s: Sodium;
beforeAll(async () => {
  s = await sodium();
});
afterEach(() => {
  resetWebKeyring();
  localStorage.clear();
});

describe("pairing a browser with a passkey", () => {
  it("puts the passkey in the claim the Mac checks, and keeps its id once paired", async () => {
    const db = fakeDb({ phone_pairings: [{ id: PAIR_ID, status: "open" }] });
    const url = pairingLink({ id: PAIR_ID, orgId: ORG, secret: newPairingSecret(s), mac: "" });
    const sleep = () => Promise.resolve(void Object.assign(db.tables.phone_pairings[0]!, { status: "paired", device_id: "dev-b" }));
    const passkey = { credId: "Y3JlZA", publicKey: "c3BraQ" };
    expect(browserPasskey("u1")).toBeNull();
    expect(await pairThisBrowser(db as never, url, { id: "u1", name: "Alex", passkey }, { everyMs: 0, sleep })).toBe("paired");
    const row = db.tables.phone_pairings[0]!;
    expect(row).toMatchObject({ passkey_id: "Y3JlZA", passkey_key: "c3BraQ" });
    expect(checkClaim(s, parsePairingLink(url)!, row as never)).toBeNull();
    expect(browserPasskey("u1")).toEqual({ device: "dev-b", credId: "Y3JlZA" });
    expect(browserPasskey("u2")).toBeNull();
  });

  it("has no passkey for a browser that paired without one", async () => {
    localStorage.setItem(BROWSER_DEVICE_KEY, JSON.stringify({ userId: "u1", deviceId: "dev-b" }));
    expect(browserPasskey("u1")).toBeNull();
    const db = fakeDb({ phone_pairings: [{ id: PAIR_ID, status: "open" }] });
    const url = pairingLink({ id: PAIR_ID, orgId: ORG, secret: newPairingSecret(s), mac: "" });
    const sleep = () => Promise.resolve(void Object.assign(db.tables.phone_pairings[0]!, { status: "paired", device_id: "dev-c" }));
    expect(await pairThisBrowser(db as never, url, { id: "u1", name: "A", passkey: null }, { everyMs: 0, sleep })).toBe("paired");
    expect(db.tables.phone_pairings[0]).not.toHaveProperty("passkey_id");
    expect(browserPasskey("u1")).toBeNull();
  });
});
