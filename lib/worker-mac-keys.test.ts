import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { macSigner } from "./mac-signer.harness";
import { macKeysAt, macSigned } from "./worker-mac-keys";

describe("macKeysAt", () => {
  it("keeps the Macs a worker trusts in mac-keys.json, mode 600, and forgets them", () => {
    const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-mac-keys-")), "home");
    const macs = macKeysAt(home);
    expect(macs.pinned()).toEqual([]);
    macs.pin("a");
    macs.pin("a");
    macs.pin("b");
    expect(macKeysAt(home).pinned()).toEqual(["a", "b"]);
    expect(fs.statSync(path.join(home, "mac-keys.json")).mode & 0o777).toBe(0o600);
    macs.forget();
    expect(macs.pinned()).toEqual([]);
  });

  it("trusts no Mac when the file isn't a list of keys", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-mac-keys-"));
    fs.writeFileSync(path.join(home, "mac-keys.json"), "{}");
    expect(macKeysAt(home).pinned()).toEqual([]);
    fs.writeFileSync(path.join(home, "mac-keys.json"), '["a", 3]');
    expect(macKeysAt(home).pinned()).toEqual(["a"]);
  });
});

describe("macSigned", () => {
  it("checks a libsodium-style signature against a raw Ed25519 key", () => {
    const mac = macSigner();
    const sig = mac.sign("hello");
    expect(macSigned(mac.key, "hello", sig)).toBe(true);
    expect(macSigned(mac.key, "hellO", sig)).toBe(false);
    expect(macSigned(macSigner().key, "hello", sig)).toBe(false);
    expect(macSigned(Buffer.from("short").toString("base64"), "hello", sig)).toBe(false);
    expect(macSigned(mac.key, "hello", "not base64 at all !!")).toBe(false);
    expect(macSigned(mac.key, "hello", undefined as unknown as string)).toBe(false);
  });
});
