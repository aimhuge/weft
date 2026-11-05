// A pairing code open on this Mac, as the thread guards see it: main marks the latest expiry (electron/pairing.cjs,
// electron/pairing-open.cjs) and lib/clipboard-guard.ts reads the same file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { pairingOpen, pairingOpenUntil } from "../lib/clipboard-guard";
import { sodium as loadSodium, type Sodium } from "../lib/sodium";
import { createPairedDevices } from "./paired-devices.cjs";
import { pairingOpenMarker, PAIRING_OPEN_FILE } from "./pairing-open.cjs";
import { createPairing, TTL_MS } from "./pairing.cjs";
import { createSyncKeys } from "./sync-keys.cjs";
import { fakeDb, fakeSafeStorage } from "./pairing.harness";
import vaultCrypto from "./vault-crypto.cjs";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let s: Sodium;
beforeAll(async () => {
  s = await loadSodium();
  await vaultCrypto.ready();
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-pair-open-"));

describe("pairingOpenMarker", () => {
  it("writes the expiry the guard reads, and removes it at 0", () => {
    const dir = tmp();
    const mark = pairingOpenMarker(dir);
    mark(5_000);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "vault", PAIRING_OPEN_FILE), "utf8"))).toEqual({ until: 5_000 });
    expect(pairingOpenUntil(dir)).toBe(5_000);
    expect(pairingOpen(4_999, dir)).toBe(true);
    expect(pairingOpen(5_000, dir)).toBe(false);
    mark(0);
    expect(fs.existsSync(path.join(dir, "vault", PAIRING_OPEN_FILE))).toBe(false);
    mark(0);
    expect(pairingOpenUntil(dir)).toBe(0);
  });

  it("warns and carries on when it can't write", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "vault"), "a file, not a folder");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    pairingOpenMarker(dir)(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("couldn't mark"));
    warn.mockRestore();
  });
});

describe("pairing marks its open codes", () => {
  it("marks the latest expiry while codes are open, and none once they close", async () => {
    const dir = tmp();
    const clock = { t: 1_000_000 };
    const mac = vaultCrypto.newKeypair();
    const db = fakeDb({ devices: [{ id: "mac-1", public_key: mac.publicKey, kind: "desktop" }] });
    const myDevice = () => Promise.resolve({ id: "mac-1", ...mac });
    const paired = createPairedDevices({ dir, safeStorage: fakeSafeStorage, sodium: () => s });
    const syncKeys = createSyncKeys({ dir, safeStorage: fakeSafeStorage, crypto: () => vaultCrypto, db: () => db, myDevice });
    const markOpen = vi.fn();
    const pairing = createPairing({ db: () => db, sodium: () => s, macDevice: () => "mac-device-id", myDevice, paired, syncKeys, confirm: () => Promise.resolve(true), now: () => clock.t, markOpen });

    const first = await pairing.start(ORG, { passkey: true });
    expect(markOpen).toHaveBeenLastCalledWith(1_000_000 + TTL_MS);
    clock.t += 1_000;
    const second = await pairing.start(ORG);
    expect(markOpen).toHaveBeenLastCalledWith(1_001_000 + TTL_MS);
    await pairing.cancel(second.id);
    expect(markOpen).toHaveBeenLastCalledWith(1_000_000 + TTL_MS);
    clock.t += TTL_MS;
    expect(await pairing.check(first.id)).toEqual({ status: "expired" });
    expect(markOpen).toHaveBeenLastCalledWith(0);
  });
});
