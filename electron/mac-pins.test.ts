import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sodium from "libsodium-wrappers";
import { beforeAll, describe, expect, it } from "vitest";
import { createMacPins } from "./mac-pins.cjs";

beforeAll(() => sodium.ready);

// A "keychain" that is not plain text on disk, so a test notices a file that isn't sealed.
const sealed = {
  encryptString: (s: string) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decryptString: (b: Buffer) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
};

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-mac-pins-"));
  const pins = createMacPins({ dir, safeStorage: () => sealed, sodium: () => sodium });
  const pair = sodium.crypto_sign_keypair();
  const signKey = sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL);
  const sign = (m: string) => sodium.to_base64(sodium.crypto_sign_detached(sodium.from_string(m), pair.privateKey), sodium.base64_variants.ORIGINAL);
  return { dir, pins, signKey, sign };
}
const mac = (signKey: string, over = {}) => ({ id: "studio", name: "Studio", signKey, pairedAt: "2026-11-12T00:00:00Z", ...over });

describe("createMacPins", () => {
  it("starts empty and keeps what it pins, sealed on disk", () => {
    const { pins, signKey } = setup();
    expect(pins.list()).toEqual([]);
    pins.pin(mac(signKey));
    expect(pins.list()).toEqual([mac(signKey)]);
    expect(fs.readFileSync(pins.file, "utf8")).not.toContain("Studio");
    expect(fs.statSync(pins.file).mode & 0o777).toBe(0o600);
  });

  it("trusts no Mac when the file won't open", () => {
    const { pins, signKey } = setup();
    pins.pin(mac(signKey));
    fs.writeFileSync(pins.file, "garbage");
    expect(pins.list()).toEqual([]);
    fs.writeFileSync(pins.file, sealed.encryptString(JSON.stringify({ macs: "x" })).toString("base64"));
    expect(pins.list()).toEqual([]);
  });

  it("pins the same Mac again with the same key, but never swaps its key", () => {
    const { pins, signKey } = setup();
    pins.pin(mac(signKey));
    pins.pin(mac(signKey, { name: "Studio 2" }));
    expect(pins.list()).toEqual([mac(signKey, { name: "Studio 2" })]);
    const other = sodium.to_base64(sodium.crypto_sign_keypair().publicKey, sodium.base64_variants.ORIGINAL);
    expect(() => pins.pin(mac(other))).toThrow("Forget it first");
    pins.unpin("studio");
    pins.pin(mac(other));
    expect(pins.list()[0]?.signKey).toBe(other);
  });

  it("unpins, saying whether anything was there", () => {
    const { pins, signKey } = setup();
    pins.pin(mac(signKey));
    pins.pin(mac(signKey, { id: "mini" }));
    expect(pins.unpin("studio")).toBe(true);
    expect(pins.unpin("studio")).toBe(false);
    expect(pins.list().map((m) => m.id)).toEqual(["mini"]);
  });

  it("verifies a signature only from a pinned Mac's key", () => {
    const { pins, signKey, sign } = setup();
    expect(pins.verify({ device: "studio", message: "m", sig: sign("m") })).toMatchObject({ ok: false, reason: expect.stringContaining("isn't paired") as unknown });
    pins.pin(mac(signKey));
    expect(pins.verify({ device: "studio", message: "m", sig: sign("m") })).toEqual({ ok: true, name: "Studio" });
    expect(pins.verify({ device: "studio", message: "other", sig: sign("m") })).toMatchObject({ ok: false, reason: expect.stringContaining("signature") as unknown });
    expect(pins.verify({ device: "studio", message: "m", sig: "!!" })).toMatchObject({ ok: false });
  });
});
