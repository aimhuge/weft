import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cjs from "../electron/worker-seal.cjs";
import { pairCode } from "./host-pairing";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { keepMessage, keptPurpose, type Keep } from "./worker-keep-wire";
import { keptVaultAt, wipeWhenRevoked } from "./worker-kept-vault";
import { KEPT_FILE, macKeysAt, trustPairingMac } from "./worker-mac-keys";
import { newSealKeys, open, type Sealed } from "./worker-seal";

const keys = newSealKeys();
const signer = macSigner();
const REPO = "github:o/r";
const base = { id: "11111111-2222-4333-8444-555555555555", orgId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", secret: "s".repeat(43) };
const NOW = 10_000_000;
const unseal = (sealed: Sealed, purpose: string) => open(keys, sealed, purpose);
let home: string;
let macs: ReturnType<typeof memoryMacs>;

const entry = (name: string, value: string, version: number, worker = "w1") => ({ name, version, sealed: cjs.seal(keys.publicKey, value, keptPurpose(worker, REPO, "development", name, version)) });
const signed = (keep: Keep, by = signer) => ({ keep, mac: { key: by.key, sig: by.sign(keepMessage(keep)) } });
const put = (seq: number, entries = [entry("A", "value-of-A", seq), entry("B", "vb", seq)], over: Record<string, unknown> = {}) => signed({ worker: "w1", seq, issuedAt: NOW, op: "put", repo: REPO, environment: "development", entries, ...over });
const vaultNow = (now = NOW) => keptVaultAt(home, "w1", macs, () => now);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kept-"));
  macs = memoryMacs([signer.key]);
});

afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("apply", () => {
  it("stores a signed put sealed as it came, mode 600, and opens it only at the version named", () => {
    const kv = vaultNow();
    expect(kv.apply(put(5))).toEqual({ seq: 5, kept: 2 });
    const file = path.join(home, KEPT_FILE);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, "utf8")).not.toContain("value-of-A");
    expect(kv.index(REPO, "development")).toEqual({ A: 5, B: 5 });
    expect(kv.index(REPO, "development", ["A"])).toEqual({ A: 5 });
    expect(kv.index(REPO, "preview")).toEqual({});
    expect(kv.open(REPO, "development", { A: 5 }, unseal)).toEqual({ A: "value-of-A" });
    expect(() => kv.open(REPO, "development", { A: 4 }, unseal)).toThrow("kept copy of A isn't the one your Mac approved");
    expect(() => kv.open(REPO, "development", { C: 5 }, unseal)).toThrow("kept copy of C");
    expect(() => kv.open("github:x/y", "development", { A: 5 }, unseal)).toThrow("kept copy of A");
    expect(() => keptVaultAt(path.join(home, "none"), "w1", macs).open(REPO, "development", { A: 5 }, unseal)).toThrow("kept copy of A");
    expect(kv.count()).toBe(2);
  });

  it("replaces the whole set on a put, deletes names, drops an environment and wipes", () => {
    const kv = vaultNow();
    kv.apply(put(5));
    kv.apply(put(6, [entry("A", "va2", 6)]));
    expect(kv.index(REPO, "development")).toEqual({ A: 6 });
    kv.apply(put(7, [entry("A", "va2", 6), entry("C", "vc", 7)]));
    kv.apply(signed({ worker: "w1", seq: 8, issuedAt: 1, op: "delete", repo: REPO, environment: "development", names: ["A"] }));
    expect(kv.index(REPO, "development")).toEqual({ C: 7 });
    expect(kv.apply(signed({ worker: "w1", seq: 9, issuedAt: 1, op: "drop", repo: REPO, environment: "development" }))).toEqual({ seq: 9, kept: 0 });
    expect(kv.count()).toBe(0);
    kv.apply(put(10));
    kv.apply(signed({ worker: "w1", seq: 11, issuedAt: 1, op: "drop", repo: REPO, environment: "preview" }));
    expect(kv.count()).toBe(2);
    kv.apply(signed({ worker: "w1", seq: 12, issuedAt: 1, op: "wipe" }));
    expect(kv.count()).toBe(0);
    // A delete in an environment it never kept leaves nothing behind.
    expect(kv.apply(signed({ worker: "w1", seq: 13, issuedAt: 1, op: "delete", repo: REPO, environment: "preview", names: ["A"] }))).toEqual({ seq: 13, kept: 0 });
    expect(fs.readFileSync(path.join(home, KEPT_FILE), "utf8")).toContain('"vaults":{}');
  });

  it("refuses what isn't the trusted Mac's, for this worker, newer and (a put) fresh", () => {
    const kv = vaultNow();
    expect(() => kv.apply({ keep: {} })).toThrow("That keep isn't one Weft makes.");
    const other = macSigner();
    expect(() => kv.apply(signed(put(5).keep, other))).toThrow("signed by a Mac this worker wasn't paired with");
    const forged = put(5);
    expect(() => kv.apply({ ...forged, keep: { ...forged.keep, seq: 6 } })).toThrow("Mac signature doesn't check out");
    expect(() => kv.apply(put(5, undefined, { worker: "w2" }))).toThrow("That keep is for another worker.");
    expect(() => vaultNow(NOW + 11 * 60_000).apply(put(5))).toThrow("too old to add values");
    expect(() => vaultNow(NOW - 11 * 60_000).apply(put(5))).toThrow("too old to add values");
    // A narrowing lands however late it is.
    expect(vaultNow(NOW + 99 * 60_000).apply(signed({ worker: "w1", seq: 3, issuedAt: 1, op: "wipe" }))).toEqual({ seq: 3, kept: 0 });
    kv.apply(put(5));
    expect(() => kv.apply(put(5))).toThrow("older than one this worker already took");
    expect(() => kv.apply(signed({ worker: "w1", seq: 4, issuedAt: 1, op: "wipe" }))).toThrow("older than one");
    macs.keys.length = 0;
    expect(() => kv.apply(put(9))).toThrow("trusts no Mac");
    expect(kv.index(REPO, "development")).toEqual({});
    expect(kv.count()).toBe(0);
  });

  it("reads another Mac's file, a garbled one or a missing one as nothing", () => {
    const kv = vaultNow();
    kv.apply(put(5));
    const file = path.join(home, KEPT_FILE);
    const theirs = macSigner();
    macs.keys.splice(0, 1, theirs.key);
    expect(kv.index(REPO, "development")).toEqual({});
    // Their first put replaces the old Mac's file outright.
    expect(kv.apply(signed(put(1, [entry("Z", "vz", 1)]).keep, theirs))).toEqual({ seq: 1, kept: 1 });
    fs.writeFileSync(file, "{nope");
    expect(kv.count()).toBe(0);
    fs.writeFileSync(file, JSON.stringify({ v: 1, mac: theirs.key, seq: 1, vaults: { [REPO]: { development: { A: { version: "x" }, B: null }, preview: 5 }, x: null } }));
    expect(kv.index(REPO, "development")).toEqual({});
    fs.writeFileSync(file, JSON.stringify({ v: 2 }));
    expect(kv.count()).toBe(0);
  });

  it("won't open a copy sealed for another slot", () => {
    const kv = vaultNow();
    kv.apply(put(5, [entry("A", "va", 5, "w2")]));
    expect(() => kv.open(REPO, "development", { A: 5 }, unseal)).toThrow("kept copy of A won't open");
  });

  it("wipes, and a pairing to another Mac wipes too, while the same Mac keeps it", () => {
    const kv = vaultNow();
    kv.apply(put(5));
    const file = path.join(home, KEPT_FILE);
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify([signer.key]));
    trustPairingMac(home, pairCode({ ...base, macKey: signer.key }));
    expect(fs.existsSync(file)).toBe(true);
    trustPairingMac(home, pairCode({ ...base, macKey: macSigner().key }));
    expect(fs.existsSync(file)).toBe(false);
    kv.apply(put(6));
    kv.wipe();
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("a revoked pairing Mac", () => {
  it("can't keep anything here, its copy reads as nothing and is deleted (lib/worker-mac-revocation.ts)", () => {
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify([signer.key]));
    const disk = macKeysAt(home);
    const kv = keptVaultAt(home, "w1", disk, () => NOW);
    kv.apply(put(5));
    expect(kv.count()).toBe(2);
    disk.revoke([signer.key]);
    expect(fs.existsSync(path.join(home, KEPT_FILE))).toBe(false);
    expect(() => kv.apply(put(6))).toThrow("trusts no Mac");
    // Revoking it again changes nothing and deletes nothing more.
    disk.revoke([signer.key]);
    expect(kv.index(REPO, "development")).toEqual({});
  });
});

describe("wipeWhenRevoked", () => {
  it("wipes once the worker's key stops working, and passes every other answer through", async () => {
    const wipe = vi.fn();
    const log = vi.fn();
    const beats = [Promise.resolve("ok"), Promise.reject(new Error("network down")), Promise.reject(new Error("worker_heartbeat: unknown worker key")), Promise.reject(new Error("worker_heartbeat: unknown worker key"))];
    const reg = { heartbeat: vi.fn((status: string) => beats.shift() ?? Promise.resolve(status)), other: 1 };
    const wrapped = wipeWhenRevoked(reg, wipe, log);
    expect(wrapped.other).toBe(1);
    await expect(wrapped.heartbeat("online")).resolves.toBe("ok");
    await expect(wrapped.heartbeat("online")).rejects.toThrow("network down");
    expect(wipe).not.toHaveBeenCalled();
    await expect(wrapped.heartbeat("online")).rejects.toThrow("unknown worker key");
    await expect(wrapped.heartbeat("online")).rejects.toThrow("unknown worker key");
    expect(wipe).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
