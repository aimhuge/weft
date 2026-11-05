import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fingerprint as fingerprintOf,
  formatFingerprint as formatOf,
  isValidFingerprint as validOf,
  normalizeFingerprint as normalizeOf,
} from "./device-fingerprint.cjs";
import { formatFingerprint, normalizeFingerprint } from "../lib/team-devices-view";

// The device's fingerprint (docs/architecture/teams-vault.md, "The fingerprint UI"): the first 16
// bytes of SHA-256 of the public key, base64-decoded, as 32 lowercase hex characters, shown in 8
// groups of 4.
//
// The web side (lib/team-devices-view.ts) formats the same value its own way, and the two must
// agree character for character — that is the whole TOFU comparison — so the tests here check this
// side against that one rather than against a restatement of the algorithm.

// A known keypair: a fixed 32-byte public key, base64-encoded the way vault-crypto.cjs encodes one.
const PUBLIC_KEY = Buffer.from("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20", "hex").toString("base64");
const OTHER_KEY = Buffer.from("ffeeddccbbaa99887766554433221100f0e0d0c0b0a0908070605040302010000", "hex").toString("base64");

// The expected value, worked out by hand from the definition rather than by running this code:
// SHA-256 of the raw key bytes, first 16 bytes, hex.
const EXPECTED = crypto.createHash("sha256").update(Buffer.from(PUBLIC_KEY, "base64")).digest("hex").slice(0, 32);

describe("fingerprint", () => {
  it("is the first 16 bytes of SHA-256 of the decoded public key, as 32 hex characters", () => {
    expect(fingerprintOf(PUBLIC_KEY)).toBe(EXPECTED);
    expect(fingerprintOf(PUBLIC_KEY)).toHaveLength(32);
    expect(fingerprintOf(PUBLIC_KEY)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("hashes the decoded bytes, not the base64 text", () => {
    // The base64 text hashed directly would give a different value, so this pins the decode step.
    const ofText = crypto.createHash("sha256").update(PUBLIC_KEY).digest("hex").slice(0, 32);
    expect(fingerprintOf(PUBLIC_KEY)).not.toBe(ofText);
  });

  it("is stable for the same key and different for another", () => {
    expect(fingerprintOf(PUBLIC_KEY)).toBe(fingerprintOf(PUBLIC_KEY));
    expect(fingerprintOf(OTHER_KEY)).not.toBe(fingerprintOf(PUBLIC_KEY));
    expect(fingerprintOf(OTHER_KEY)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses a key that isn't there", () => {
    expect(() => fingerprintOf("")).toThrow(/public key/);
    expect(() => fingerprintOf(null as unknown as string)).toThrow(/public key/);
    // Not a 32-byte key: Node's base64 decoder skips what it can't read, so the length is the check.
    expect(() => fingerprintOf("!!!not base64!!!")).toThrow(/32-byte/);
    expect(() => fingerprintOf(Buffer.alloc(16).toString("base64"))).toThrow(/32-byte/);
  });
});

describe("formatFingerprint", () => {
  it("groups the 32 characters into 8 groups of 4", () => {
    const groups = formatOf(fingerprintOf(PUBLIC_KEY)).split(" ");
    expect(groups).toHaveLength(8);
    for (const group of groups) expect(group).toMatch(/^[0-9a-f]{4}$/);
    expect(groups.join("")).toBe(fingerprintOf(PUBLIC_KEY));
  });

  it("reads the way the design shows it: eight groups of four hex characters", () => {
    expect(formatOf("a1b2c3d4e5f67890abcdef0123456789")).toBe("a1b2 c3d4 e5f6 7890 abcd ef01 2345 6789");
  });

  it("shows a fingerprint it can't parse as it was given, rather than as nothing", () => {
    expect(formatOf("not a fingerprint")).toBe("not a fingerprint");
    expect(formatOf("a1b2c3d4")).toBe("a1b2c3d4");
    expect(formatOf(null)).toBe("");
  });
});

describe("normalizeFingerprint", () => {
  it("reduces any spacing, casing and separators to the same 32 characters", () => {
    const hex = fingerprintOf(PUBLIC_KEY);
    const spaced = formatOf(hex);
    const colon = hex.match(/.{2}/g)!.join(":");
    const dashed = hex.match(/.{4}/g)!.join("-");
    for (const shape of [hex, spaced, colon, dashed, hex.toUpperCase(), spaced.toUpperCase(), `  ${spaced}  `]) {
      expect(normalizeOf(shape)).toBe(hex);
    }
  });

  it("rejects anything that isn't 32 hex characters", () => {
    const hex = fingerprintOf(PUBLIC_KEY);
    expect(normalizeOf("a1b2c3d4")).toBeNull();
    // A stray non-hex character is stripped, so the rest still reads as the fingerprint; too many
    // characters and what is left isn't a fingerprint any more.
    expect(normalizeOf(`${hex}z`)).toBe(hex);
    expect(normalizeOf(`${hex}00`)).toBeNull();
    expect(normalizeOf(null)).toBeNull();
    expect(normalizeOf(undefined)).toBeNull();
    expect(validOf(formatOf(hex))).toBe(true);
    expect(validOf("nope")).toBe(false);
  });
});

describe("the two sides of the TOFU check", () => {
  it("formats a fingerprint the way the web side formats it", () => {
    // Same key, same string, both sides — the comparison the user makes by eye.
    const hex = fingerprintOf(PUBLIC_KEY);
    expect(formatOf(hex)).toBe(formatFingerprint(hex));
    expect(normalizeOf(hex)).toBe(normalizeFingerprint(hex));
  });

  it("agrees on what a pasted fingerprint means, spacing and casing and all", () => {
    const hex = fingerprintOf(PUBLIC_KEY);
    const shapes = [hex, formatOf(hex), hex.match(/.{2}/g)!.join(":"), formatOf(hex).toUpperCase()];
    for (const shape of shapes) {
      expect(normalizeOf(shape)).toBe(normalizeFingerprint(shape));
      expect(formatOf(shape)).toBe(formatFingerprint(shape));
    }
  });

  it("rejects the same wrong lengths on both sides", () => {
    for (const bad of ["", "a1b2", "a1b2c3d4e5f67890abcdef01234567890"]) {
      expect(normalizeOf(bad)).toBe(normalizeFingerprint(bad));
    }
  });
});
