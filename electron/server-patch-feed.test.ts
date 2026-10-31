import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { FIELDS, signPatch, verifyPatch, whyNot } from "./server-patch-feed.cjs";

// Throwaway ed25519 pairs, made inside the test: nothing here is a real signing key.
function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKeyB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeyB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

const DETAILS = {
  version: "0.6.7",
  build: "0.6.7+abc123",
  seq: 12,
  deps: "deps-hash",
  url: "https://github.com/aimhuge/weft/releases/download/patch-latest/weft-server-0.6.7+abc123.tar.gz",
  sha256: "abc",
  size: 42,
};

describe("signPatch and verifyPatch", () => {
  it("signs the details and verifies them back", () => {
    const { privateKeyB64, publicKeyB64 } = keyPair();
    const feed = signPatch(DETAILS, privateKeyB64);
    expect(typeof feed.payload).toBe("string");
    expect(typeof feed.signature).toBe("string");
    expect(JSON.parse(feed.payload)).toEqual(DETAILS);
    expect(verifyPatch(feed, publicKeyB64)).toEqual(DETAILS);
  });

  it("rejects a bad signature", () => {
    const signer = keyPair();
    const other = keyPair();
    const feed = signPatch(DETAILS, signer.privateKeyB64);
    // A well-formed key that isn't the signer's: the signature doesn't check out.
    expect(() => verifyPatch(feed, other.publicKeyB64)).toThrow("patch feed: bad signature");
  });

  it("rejects a signature that isn't a signature at all", () => {
    const { privateKeyB64, publicKeyB64 } = keyPair();
    const feed = signPatch(DETAILS, privateKeyB64);
    expect(() => verifyPatch({ ...feed, signature: "not-base64-ed25519" }, publicKeyB64)).toThrow("patch feed: bad signature");
  });

  it("rejects a tampered payload", () => {
    const { privateKeyB64, publicKeyB64 } = keyPair();
    const feed = signPatch(DETAILS, privateKeyB64);
    const tampered = { ...feed, payload: feed.payload.replace("abc123", "evil999") };
    expect(() => verifyPatch(tampered, publicKeyB64)).toThrow("patch feed: bad signature");
  });

  it("rejects a feed signed by another key", () => {
    const mine = keyPair();
    const theirs = keyPair();
    const feed = signPatch(DETAILS, theirs.privateKeyB64);
    expect(() => verifyPatch(feed, mine.publicKeyB64)).toThrow("patch feed: bad signature");
  });

  it("rejects a malformed feed", () => {
    const { publicKeyB64 } = keyPair();
    expect(() => verifyPatch(null, publicKeyB64)).toThrow("patch feed: malformed");
    expect(() => verifyPatch({ payload: "{}" }, publicKeyB64)).toThrow("patch feed: malformed");
    expect(() => verifyPatch({ signature: "x" }, publicKeyB64)).toThrow("patch feed: malformed");
    expect(() => verifyPatch({ payload: 1, signature: "x" }, publicKeyB64)).toThrow("patch feed: malformed");
  });

  it("names every missing field", () => {
    const { privateKeyB64, publicKeyB64 } = keyPair();
    const partial = { ...DETAILS } as Record<string, unknown>;
    delete partial.url;
    delete partial.sha256;
    const feed = signPatch(partial as never, privateKeyB64);
    expect(() => verifyPatch(feed, publicKeyB64)).toThrow("patch feed: missing url, sha256");
    expect(FIELDS).toEqual(["version", "build", "seq", "deps", "url", "sha256", "size"]);
  });

  it("requires an https url", () => {
    const { privateKeyB64, publicKeyB64 } = keyPair();
    const feed = signPatch({ ...DETAILS, url: "http://example.test/patch.tar.gz" }, privateKeyB64);
    expect(() => verifyPatch(feed, publicKeyB64)).toThrow("patch feed: url isn't https");
  });
});

describe("whyNot", () => {
  const local = { version: "0.6.7", deps: "deps-hash" };

  it("allows a patch for this version, built against the same packages, newer than now", () => {
    expect(whyNot(DETAILS, { ...local, activeSeq: 3 })).toBeNull();
  });

  it("refuses a patch for another app version", () => {
    expect(whyNot(DETAILS, { version: "0.6.8", deps: "deps-hash" })).toBe("built for Weft 0.6.7, this is 0.6.8");
  });

  it("refuses a patch when this build has no package fingerprint", () => {
    expect(whyNot(DETAILS, { version: "0.6.7", deps: null })).toBe("this build has no package fingerprint");
  });

  it("refuses a patch built against different packages", () => {
    expect(whyNot(DETAILS, { version: "0.6.7", deps: "other-hash" })).toBe("built against different packages");
  });

  it("refuses a patch that already failed here", () => {
    expect(whyNot(DETAILS, { ...local, bad: ["0.6.7+abc123"] })).toBe("0.6.7+abc123 failed to start here before");
  });

  it("refuses a patch that isn't newer than the one running", () => {
    expect(whyNot(DETAILS, { ...local, activeSeq: 12 })).toBe("not newer than the patch running now");
    expect(whyNot(DETAILS, { ...local, activeSeq: 99 })).toBe("not newer than the patch running now");
  });

  it("refuses a patch no newer than seq 0", () => {
    expect(whyNot({ ...DETAILS, seq: 0 }, { ...local })).toBe("not newer than the patch running now");
  });
});
