// The open that starts a synced folder's `tree` channel (lib/tree-sync-proof.ts): parsing it strictly, and refusing
// anything but a fresh, once-only request signed by a Mac this worker pinned.
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { OPEN_MAX_SKEW_MS, OPEN_PREFIX, openMessage, openRefusal, readSyncOpen, type SyncOpen } from "./tree-sync-proof";
import { nonceBook } from "./widen-nonces";

const NOW = 1_800_000_000_000;
const WORKER = "Worker-ABC";
const NONCE = "0123456789abcdef0123456789abcdef";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const KEY = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
const signOver = (message: string) => sign(null, Buffer.from(message), privateKey).toString("base64");

function signedOpen(over: { folder?: string; issuedAt?: number; nonce?: string; workerId?: string } = {}): SyncOpen {
  const folder = over.folder ?? "my-app";
  const issuedAt = over.issuedAt ?? NOW;
  const nonce = over.nonce ?? NONCE;
  return { t: "open", folder, mac: { key: KEY, sig: signOver(openMessage(over.workerId ?? WORKER, folder, issuedAt, nonce)), issuedAt, nonce } };
}

function deps(keys: string[] = [KEY]) {
  const kept: Record<string, number> = {};
  return { workerId: WORKER, macKeys: () => keys, nonces: nonceBook({ load: () => ({ ...kept }), save: (n) => Object.assign(kept, n) }, () => NOW), now: () => NOW };
}

describe("openMessage", () => {
  it("joins the prefix, the lower-cased worker id, folder, time and nonce by newlines", () => {
    expect(openMessage("ABC", "f", 5, "n")).toBe([OPEN_PREFIX, "abc", "f", "5", "n"].join("\n"));
  });
});

describe("readSyncOpen", () => {
  const good = { t: "open", folder: "my-app", mac: { key: "k", sig: "s", issuedAt: 1, nonce: NONCE } };
  const raw = (o: unknown) => JSON.stringify(o);

  it("reads a well-formed open, dropping extra fields", () => {
    expect(readSyncOpen(raw({ ...good, extra: 1, mac: { ...good.mac, more: 2 } }))).toEqual(good);
  });

  it("rejects bad JSON and null", () => {
    expect(readSyncOpen("{nope")).toBeNull();
    expect(readSyncOpen("null")).toBeNull();
  });

  it("rejects a wrong t", () => {
    expect(readSyncOpen(raw({ ...good, t: "data" }))).toBeNull();
  });

  it.each([[123], [""], ["a/b"], [".hidden"], [".."], ["x".repeat(201)]])("rejects folder %j", (folder) => {
    expect(readSyncOpen(raw({ ...good, folder }))).toBeNull();
  });

  it("rejects a missing mac and missing or mistyped mac fields", () => {
    expect(readSyncOpen(raw({ ...good, mac: undefined }))).toBeNull();
    expect(readSyncOpen(raw({ ...good, mac: { ...good.mac, key: 1 } }))).toBeNull();
    expect(readSyncOpen(raw({ ...good, mac: { ...good.mac, sig: null } }))).toBeNull();
    expect(readSyncOpen(raw({ ...good, mac: { ...good.mac, nonce: 5 } }))).toBeNull();
    expect(readSyncOpen(raw({ ...good, mac: { ...good.mac, issuedAt: "1" } }))).toBeNull();
    expect(readSyncOpen(raw({ ...good, mac: { ...good.mac, issuedAt: null } }))).toBeNull();
  });

  it.each([["short"], [NONCE.toUpperCase()], [`${NONCE}0`], ["g".repeat(32)]])("rejects nonce %j", (nonce) => {
    expect(readSyncOpen(raw({ ...good, mac: { ...good.mac, nonce } }))).toBeNull();
  });
});

describe("openRefusal", () => {
  it("passes a pinned Mac's fresh signed open and spends its nonce", async () => {
    const d = deps();
    await expect(openRefusal(signedOpen(), d)).resolves.toBeNull();
    expect(d.nonces.has(NONCE)).toBe(true);
  });

  it("refuses a reused nonce", async () => {
    const d = deps();
    await openRefusal(signedOpen(), d);
    await expect(openRefusal(signedOpen(), d)).resolves.toBe("That sync request was used already.");
  });

  it("refuses an unpinned key", async () => {
    await expect(openRefusal(signedOpen(), deps(["other"]))).resolves.toBe("Only the Mac this worker was paired with can sync a folder with it.");
  });

  it("refuses a stale or future open", async () => {
    await expect(openRefusal(signedOpen({ issuedAt: NOW - OPEN_MAX_SKEW_MS - 1 }), deps())).resolves.toMatch(/too old/);
    await expect(openRefusal(signedOpen({ issuedAt: NOW + OPEN_MAX_SKEW_MS + 1 }), deps())).resolves.toMatch(/too old/);
    await expect(openRefusal(signedOpen({ issuedAt: NOW - OPEN_MAX_SKEW_MS }), deps())).resolves.toBeNull();
  });

  it("refuses a signature over another folder or worker", async () => {
    const o = signedOpen();
    await expect(openRefusal({ ...o, folder: "other" }, deps())).resolves.toBe("That sync request isn't signed by your Mac.");
    await expect(openRefusal(signedOpen({ workerId: "someone-else" }), deps())).resolves.toBe("That sync request isn't signed by your Mac.");
  });

  it("signs over the worker id case-insensitively", async () => {
    await expect(openRefusal(signedOpen({ workerId: WORKER.toLowerCase() }), deps())).resolves.toBeNull();
  });

  it("uses an injected verify, and Date.now when no clock is given", async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      const verify = vi.fn(() => true);
      const d = { ...deps(), now: undefined, verify };
      await expect(openRefusal({ ...signedOpen(), mac: { ...signedOpen().mac, sig: "junk" } }, d)).resolves.toBeNull();
      expect(verify).toHaveBeenCalledWith(KEY, openMessage(WORKER, "my-app", NOW, NONCE), "junk");
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the book to keep the nonce for two skews past its time", async () => {
    const take = vi.fn(() => Promise.resolve(true));
    await openRefusal(signedOpen(), { ...deps(), nonces: { has: () => false, take } });
    expect(take).toHaveBeenCalledWith(NONCE, NOW + 2 * OPEN_MAX_SKEW_MS, NOW);
  });
});
