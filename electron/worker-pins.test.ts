import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkerPins, fingerprint } from "./worker-pins.cjs";

// A stand-in for safeStorage that really changes the bytes, so a plain JSON write would fail to open.
const store = () => ({ encryptString: (s: string) => Buffer.from(s).reverse(), decryptString: (b: Buffer) => Buffer.from(b).reverse().toString() });
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-worker-pins-"));
const KEY_A = Buffer.from("key-a").toString("base64");
const KEY_B = Buffer.from("key-b").toString("base64");

describe("createWorkerPins", () => {
  it("looks a worker up without pinning, pins only when told, then holds it to that key", () => {
    const d = dir();
    const pins = createWorkerPins({ dir: d, safeStorage: store, now: () => new Date("2026-11-02T00:00:00Z") });
    expect(pins.lookup({ id: "w1", name: "m1mini", publicKey: KEY_A })).toEqual({ publicKey: KEY_A, fingerprint: fingerprint(KEY_A), firstUse: true });
    // A lookup writes nothing: a Deny, or an error before the Allow, leaves no pin behind.
    expect(fs.existsSync(path.join(d, "vault", "worker-pins.json"))).toBe(false);
    expect(pins.lookup({ id: "w1", name: "m1mini", publicKey: KEY_B }).firstUse).toBe(true);
    pins.pin("w1", { name: "m1mini", publicKey: KEY_A });
    expect(pins.lookup({ id: "w1", name: "renamed", publicKey: KEY_A })).toEqual({ publicKey: KEY_A, fingerprint: fingerprint(KEY_A), firstUse: false });
    expect(() => pins.lookup({ id: "w1", name: "m1mini", publicKey: KEY_B })).toThrow(`m1mini's key changed since this Mac pinned it (${fingerprint(KEY_A)}, now ${fingerprint(KEY_B)})`);
    const file = path.join(d, "vault", "worker-pins.json");
    expect(fs.readFileSync(file, "utf8")).not.toContain(KEY_A);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(createWorkerPins({ dir: d, safeStorage: store }).lookup({ id: "w1", name: "m1mini", publicKey: KEY_A }).firstUse).toBe(false);
  });

  it("keeps a paired worker's sign key with its box key, through a Re-pin and the next pin", () => {
    const pins = createWorkerPins({ dir: dir(), safeStorage: store });
    pins.pin("w2", { name: "box", publicKey: KEY_A, signKey: "c2lnbg==" });
    expect(pins.lookup({ id: "w2", name: "box", publicKey: KEY_A })).toMatchObject({ signKey: "c2lnbg==", firstUse: false });
    expect(pins.forget("w2")).toBe(true);
    expect(pins.forget("w2")).toBe(false);
    expect(pins.lookup({ id: "w2", name: "box", publicKey: KEY_B })).toEqual({ publicKey: KEY_B, signKey: "c2lnbg==", fingerprint: fingerprint(KEY_B), firstUse: true });
    pins.pin("w2", { name: "box", publicKey: KEY_B });
    expect(pins.lookup({ id: "w2", name: "box", publicKey: KEY_B })).toMatchObject({ signKey: "c2lnbg==", firstUse: false });
  });

  it("forgets a pin, so a re-pinned worker is pinned afresh", () => {
    const pins = createWorkerPins({ dir: dir(), safeStorage: store });
    expect(pins.forget("w1")).toBe(false);
    pins.pin("w1", { name: "m1mini", publicKey: KEY_A });
    expect(pins.forget("w1")).toBe(true);
    expect(pins.lookup({ id: "w1", name: "m1mini", publicKey: KEY_B }).firstUse).toBe(true);
  });

  it("refuses every worker when the file won't open or isn't a pin list", () => {
    const d = dir();
    fs.mkdirSync(path.join(d, "vault"));
    fs.writeFileSync(path.join(d, "vault", "worker-pins.json"), "tampered");
    const pins = createWorkerPins({ dir: d, safeStorage: store });
    expect(() => pins.lookup({ id: "w1", name: "m1mini", publicKey: KEY_A })).toThrow("pinned worker keys won't open");
    fs.writeFileSync(path.join(d, "vault", "worker-pins.json"), store().encryptString("[]").toString("base64"));
    expect(() => pins.lookup({ id: "w1", name: "m1mini", publicKey: KEY_A })).toThrow("won't open");
  });

  it("fingerprints a key as four groups of hex", () => {
    expect(fingerprint(KEY_A)).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    expect(fingerprint(KEY_A)).not.toBe(fingerprint(KEY_B));
  });
});
