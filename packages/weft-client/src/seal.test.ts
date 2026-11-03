import { beforeAll, describe, expect, it } from "vitest";
import sodiumModule from "libsodium-wrappers";
import { answerKeys, rawX25519, sealedOf, sealTo, spkiX25519, type SealCrypto, type SubtleLike } from "./seal";

let c: SealCrypto;
beforeAll(async () => {
  await sodiumModule.ready;
  c = { sodium: sodiumModule, subtle: globalThis.crypto.subtle as unknown as SubtleLike };
});

const pair = () => {
  const raw = sodiumModule.crypto_box_keypair();
  return { pub: spkiX25519(c.sodium, raw.publicKey), raw };
};

describe("a worker's key", () => {
  it("round-trips between SPKI and raw", () => {
    const { pub, raw } = pair();
    expect(rawX25519(c.sodium, pub)).toEqual(raw.publicKey);
    expect(Buffer.from(pub, "base64").subarray(0, 12).toString("hex")).toBe("302a300506032b656e032100");
  });

  it("is refused when it isn't an X25519 SPKI", () => {
    const { pub } = pair();
    const der = Buffer.from(pub, "base64");
    expect(() => rawX25519(c.sodium, "not base64!")).toThrow("isn't an X25519 key");
    expect(() => rawX25519(c.sodium, der.subarray(0, 40).toString("base64"))).toThrow("isn't an X25519 key");
    // An Ed25519 SPKI has the same length but another OID.
    const ed = Buffer.from(der);
    ed[8] = 0x70;
    expect(() => rawX25519(c.sodium, ed.toString("base64"))).toThrow("isn't an X25519 key");
  });
});

describe("sealTo", () => {
  it("makes a fresh ephemeral key and iv each time, in the server's shape", async () => {
    const { pub } = pair();
    const a = await sealTo(c, pub, "hello", "p");
    const b = await sealTo(c, pub, "hello", "p");
    expect(sealedOf(a)).toEqual(a);
    expect(a.v).toBe(1);
    expect(a.epk).not.toBe(b.epk);
    expect(a.iv).not.toBe(b.iv);
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(a.tag, "base64")).toHaveLength(16);
    expect(Buffer.from(a.ct, "base64")).toHaveLength(5);
  });

  it("refuses a low-order key rather than seal to a known secret", async () => {
    const zero = spkiX25519(c.sodium, new Uint8Array(32));
    await expect(sealTo(c, zero, "x", "p")).rejects.toThrow();
  });

  it("says so in its own words when the shared secret comes out all zero", async () => {
    const quiet = { ...c, sodium: { ...c.sodium, crypto_scalarmult: () => new Uint8Array(32) } };
    await expect(sealTo(quiet, pair().pub, "x", "p")).rejects.toThrow("isn't an X25519 key");
  });
});

describe("answerKeys", () => {
  it("opens what its key sealed, and nothing under another key", async () => {
    const keys = answerKeys(c);
    const key = keys.newKey();
    expect(Buffer.from(key, "base64")).toHaveLength(32);
    const aes = await globalThis.crypto.subtle.importKey("raw", Buffer.from(key, "base64"), "AES-GCM", false, ["encrypt"]);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode("v=0 answer")));
    const sealed = { iv: Buffer.from(iv).toString("base64"), ct: Buffer.from(ct).toString("base64") };
    await expect(keys.open(key, sealed)).resolves.toBe("v=0 answer");
    await expect(keys.open(keys.newKey(), sealed)).rejects.toThrow();
  });
});

describe("sealedOf", () => {
  it("takes only a whole sealed value", () => {
    expect(sealedOf(null)).toBeNull();
    expect(sealedOf("x")).toBeNull();
    expect(sealedOf({ v: 2, epk: "a", iv: "b", ct: "c", tag: "d" })).toBeNull();
    expect(sealedOf({ v: 1, epk: "a", iv: "b", ct: "c" })).toBeNull();
    expect(sealedOf({ v: 1, epk: "a b", iv: "b", ct: "c", tag: "d" })).toBeNull();
    expect(sealedOf({ v: 1, epk: "a", iv: "b", ct: "c", tag: "d" })).toEqual({ v: 1, epk: "a", iv: "b", ct: "c", tag: "d" });
  });
});
