import { describe, expect, it } from "vitest";
import { CLAUDE_TOKEN, LOGIN_PURPOSE, newSealKeys, open, seal, sealedOf } from "./worker-seal";

const TOKEN = ["sk-ant", "oat01", "abcdefghijklmnopqrstuvwxyz0123"].join("-");

describe("seal and open", () => {
  it("opens with the worker's keys what was sealed to its public key", () => {
    const keys = newSealKeys();
    const sealed = seal(keys.publicKey, TOKEN, LOGIN_PURPOSE);
    expect(sealed.ct).not.toContain(TOKEN);
    expect(JSON.stringify(sealed)).not.toContain("sk-ant");
    expect(open(keys, sealed, LOGIN_PURPOSE)).toBe(TOKEN);
  });

  it("seals the same value differently every time", () => {
    const keys = newSealKeys();
    expect(seal(keys.publicKey, TOKEN, LOGIN_PURPOSE).ct).not.toBe(seal(keys.publicKey, TOKEN, LOGIN_PURPOSE).ct);
  });

  it("won't open with another worker's keys", () => {
    const sealed = seal(newSealKeys().publicKey, TOKEN, LOGIN_PURPOSE);
    expect(() => open(newSealKeys(), sealed, LOGIN_PURPOSE)).toThrow();
  });

  it("won't open for another purpose", () => {
    const keys = newSealKeys();
    expect(() => open(keys, seal(keys.publicKey, TOKEN, "vault"), LOGIN_PURPOSE)).toThrow();
  });

  it("won't open bytes changed on the way", () => {
    const keys = newSealKeys();
    const sealed = seal(keys.publicKey, TOKEN, LOGIN_PURPOSE);
    const ct = Buffer.from(sealed.ct, "base64");
    ct.writeUInt8(ct.readUInt8(0) ^ 1, 0);
    expect(() => open(keys, { ...sealed, ct: ct.toString("base64") }, LOGIN_PURPOSE)).toThrow();
  });

  it("makes a public key the database's check accepts", () => {
    expect(newSealKeys().publicKey).toMatch(/^[A-Za-z0-9+/=]{40,200}$/);
  });
});

describe("sealedOf", () => {
  it("reads a sealed value and refuses anything else", () => {
    const sealed = seal(newSealKeys().publicKey, TOKEN, LOGIN_PURPOSE);
    expect(sealedOf(JSON.parse(JSON.stringify(sealed)))).toEqual(sealed);
    expect(sealedOf(null)).toBeNull();
    expect(sealedOf("x")).toBeNull();
    expect(sealedOf({ ...sealed, v: 2 })).toBeNull();
    expect(sealedOf({ ...sealed, iv: 3 })).toBeNull();
    expect(sealedOf({ ...sealed, tag: "not base64!" })).toBeNull();
  });
});

describe("CLAUDE_TOKEN", () => {
  it("takes a Claude Code token and nothing shorter or other", () => {
    expect(CLAUDE_TOKEN.test(TOKEN)).toBe(true);
    expect(CLAUDE_TOKEN.test("sk-ant-short")).toBe(false);
    expect(CLAUDE_TOKEN.test(`sk_live_${"a".repeat(26)}`)).toBe(false);
  });
});
