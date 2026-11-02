// The box's half of pairing a worker (lib/host-pairing.ts) against main's check (electron/host-pairing.cjs): a claim
// the box makes passes, and any field changed after the proof and signature were made doesn't.
import { describe, expect, it } from "vitest";
import { checkCode as mainCheckCode, checkHostClaim } from "../electron/host-pairing.cjs";
import {
  checkCode, hostClaimMessage, isPairCode, keyHash, makeHostClaim, safeName, newPairSecret, newSignKeys, newWorkerKey, pairCode, parsePairCode, proofOf,
} from "./host-pairing";

const ID = "11111111-2222-4333-8444-555555555555";
const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const code = { id: ID, orgId: ORG, secret: newPairSecret() };
const sign = newSignKeys();
const body = { name: "m1mini", platform: "darwin", arch: "arm64", box_key: "Ym94LWtleQ==", sign_key: sign.publicKey, key_hash: keyHash(newWorkerKey()) };

describe("the pairing code", () => {
  it("round-trips and rides a shell argument", () => {
    const text = pairCode(code);
    expect(text).toMatch(/^wph\.[\w.-]+$/);
    expect(isPairCode(` ${text} `)).toBe(true);
    expect(parsePairCode(` ${text}\n`)).toEqual(code);
  });

  it("refuses anything that isn't a whole code", () => {
    expect(parsePairCode("wet_abc")).toBeNull();
    expect(parsePairCode(`wph.${ID}.${ORG}`)).toBeNull();
    expect(parsePairCode(`wph.not-a-uuid.${ORG}.${code.secret}`)).toBeNull();
    expect(parsePairCode(`wph.${ID}.nope.${code.secret}`)).toBeNull();
    expect(parsePairCode(`wph.${ID}.${ORG}.short`)).toBeNull();
    expect(parsePairCode(`${pairCode(code)}.extra`)).toBeNull();
    expect(isPairCode("wet_abc")).toBe(false);
  });
});

describe("keys", () => {
  it("makes a worker key in worker_enrol's shape and hashes it as sha256 hex", () => {
    const key = newWorkerKey();
    expect(key).toMatch(/^wwk_[0-9a-f]{64}$/);
    expect(keyHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("makes an Ed25519 pair that fits the claim's columns", () => {
    expect(sign.publicKey.length).toBeLessThanOrEqual(100);
  });

  it("proves with libsodium's crypto_auth bytes (HMAC-SHA-512 cut to 32)", () => {
    expect(Buffer.from(proofOf(code.secret, "m"), "base64")).toHaveLength(32);
  });
});

describe("a worker's claim, checked by main", () => {
  const claim = makeHostClaim(code, body, sign);
  const row = { ...claim, kind: "worker" };

  it("passes as made", () => {
    expect(checkHostClaim(code, row)).toBeNull();
    expect(claim.sig.length).toBeLessThanOrEqual(200);
  });

  it("shows the same check code on both sides", () => {
    expect(checkCode(ID, ORG, body)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(mainCheckCode(ID, ORG, body)).toBe(checkCode(ID, ORG, body));
  });

  it("fails when any signed field changed: the server swapped a key, the hash, the name", () => {
    for (const field of ["box_key", "key_hash", "name", "arch"] as const) {
      const changed = { ...row, [field]: field === "key_hash" ? "f".repeat(64) : `${row[field]}x` };
      expect(checkHostClaim(code, changed)).toBe("The claim wasn't made with this code.");
    }
  });

  it("fails with another code's secret", () => {
    expect(checkHostClaim({ ...code, secret: newPairSecret() }, row)).toBe("The claim wasn't made with this code.");
    expect(checkHostClaim({ ...code, id: "99999999-2222-4333-8444-555555555555" }, row)).toBe("The claim wasn't made with this code.");
  });

  it("fails when the sign key isn't the one that signed", () => {
    const other = newSignKeys();
    const forged = makeHostClaim(code, { ...body, sign_key: other.publicKey }, sign);
    expect(checkHostClaim(code, { ...forged, kind: "worker" })).toBe("The claim's signature doesn't match its key.");
  });

  it("fails on a short proof, an unreadable key, a phone's kind, a missing field, a bad platform or hash", () => {
    expect(checkHostClaim(code, { ...row, proof: "AAAA" })).toBe("The claim wasn't made with this code.");
    const garbled = makeHostClaim(code, { ...body, sign_key: "bm90IGEga2V5" }, sign);
    expect(checkHostClaim(code, { ...garbled, kind: "worker" })).toBe("The claim isn't readable.");
    expect(checkHostClaim(code, { ...row, kind: "phone" })).toBe("The claim isn't a worker's.");
    expect(checkHostClaim(code, { ...row, sig: "" })).toBe("The claim is missing a field.");
    expect(checkHostClaim(code, { ...row, platform: "ios" })).toBe("The claim names an unknown kind of worker.");
    expect(checkHostClaim(code, { ...row, key_hash: "nothex" })).toBe("The claim names an unknown kind of worker.");
    expect(checkHostClaim(code, { ...row, name: "two\nlines" })).toBe("The claim's name has characters a worker's name can't.");
    expect(checkHostClaim(code, { ...row, name: 'm1" to run rm -rf' })).toBe("The claim's name has characters a worker's name can't.");
    expect(checkHostClaim(code, { ...row, name: "evil\u202Egnp" })).toBe("The claim's name has characters a worker's name can't.");
    expect(checkHostClaim(code, { ...row, arch: "a\tb" })).toBe("The claim's arch isn't one line.");
  });

  it("refuses an RSA key where the Ed25519 one goes", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const forged = makeHostClaim(code, { ...body, sign_key: rsa }, sign);
    expect(checkHostClaim(code, { ...forged, kind: "worker" })).toBe("The claim's signature doesn't match its key.");
  });

  it("takes a claim with no arch as an empty one", () => {
    const bare = makeHostClaim(code, { ...body, arch: "" }, sign);
    expect(checkHostClaim(code, { ...bare, kind: "worker", arch: null })).toBeNull();
  });
});

describe("safeName", () => {
  it("keeps a host name to the characters a prompt can show safely", () => {
    expect(safeName("Alex's Mac mini (2)")).toBe("Alexs Mac mini (2)");
    expect(safeName('m1"\n\u202Emini')).toBe("m1mini");
    expect(safeName("  a   b  ")).toBe("a b");
    expect(safeName("x".repeat(90))).toHaveLength(80);
    expect(safeName("\"'")).toBe("worker");
  });
});

describe("makeHostClaim", () => {
  it("refuses a name or arch that would break the message's lines", () => {
    expect(() => makeHostClaim(code, { ...body, name: "a\nb" }, sign)).toThrow("up to 80 letters");
    expect(() => makeHostClaim(code, { ...body, name: "x".repeat(81) }, sign)).toThrow("up to 80 letters");
    expect(() => makeHostClaim(code, { ...body, name: "Alex's Mac" }, sign)).toThrow("up to 80 letters");
    expect(() => makeHostClaim(code, { ...body, arch: "a\nb" }, sign)).toThrow("one short line");
    expect(() => makeHostClaim(code, { ...body, arch: "x".repeat(21) }, sign)).toThrow("one short line");
  });

  it("signs the message main rebuilds", () => {
    expect(hostClaimMessage(ID, ORG, body).split("\n")).toEqual(["weft-host-pair-v1", ID, ORG, body.box_key, body.sign_key, body.key_hash, "m1mini", "darwin", "arm64"]);
  });
});
