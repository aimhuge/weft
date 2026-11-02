import { describe, expect, it } from "vitest";
import { connectorKey, openToken, sealToken } from "./connector-crypto";

const HEX = "ab".repeat(32);

describe("connectorKey", () => {
  it("takes 64 hex chars with an optional key id", () => {
    expect(connectorKey({ WEFT_CONNECTOR_TOKEN_KEY: ` ${HEX} ` })).toEqual({ id: "v1", key: Buffer.from(HEX, "hex") });
    expect(connectorKey({ WEFT_CONNECTOR_TOKEN_KEY: HEX, WEFT_CONNECTOR_TOKEN_KEY_ID: " v2 " })?.id).toBe("v2");
  });
  it("is null for a missing or malformed key", () => {
    expect(connectorKey({})).toBeNull();
    expect(connectorKey({ WEFT_CONNECTOR_TOKEN_KEY: "ab" })).toBeNull();
    expect(connectorKey({ WEFT_CONNECTOR_TOKEN_KEY: "zz".repeat(32) })).toBeNull();
  });
  it("keeps retired keys by id for opening, never the current one", () => {
    const old = "cd".repeat(32);
    const k = connectorKey({ WEFT_CONNECTOR_TOKEN_KEY: HEX, WEFT_CONNECTOR_TOKEN_KEY_ID: "v2", WEFT_CONNECTOR_TOKEN_KEYS_OLD: ` v1:${old}, v2:${old}, bad, v0:zz ` });
    expect(k).toEqual({ id: "v2", key: Buffer.from(HEX, "hex"), old: { v1: Buffer.from(old, "hex") } });
    expect(connectorKey({ WEFT_CONNECTOR_TOKEN_KEY: HEX, WEFT_CONNECTOR_TOKEN_KEYS_OLD: "junk" })).toEqual({ id: "v1", key: Buffer.from(HEX, "hex") });
  });

  it("reads process.env by default", () => {
    expect(connectorKey() === null || connectorKey()?.key.length === 32).toBe(true);
  });
});

describe("a key rotation", () => {
  it("opens what an old key sealed and seals only with the new one", () => {
    const v1 = { id: "v1", key: Buffer.alloc(32, 1) };
    const sealed = sealToken("ghr_x", "refresh:u1", v1);
    const now = { id: "v2", key: Buffer.alloc(32, 2), old: { v1: v1.key } };
    expect(openToken(sealed, "refresh:u1", now)).toBe("ghr_x");
    expect(sealToken("ghr_y", "refresh:u1", now).startsWith("v2.")).toBe(true);
    expect(openToken(sealed, "refresh:u1", { id: "v2", key: now.key })).toBeNull();
  });
});

describe("sealToken and openToken", () => {
  const k = { id: "v1", key: Buffer.from(HEX, "hex") };

  it("opens what it sealed, under the same binding", () => {
    const sealed = sealToken("ghr_secret", "refresh:u1", k);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("ghr_secret");
    expect(openToken(sealed, "refresh:u1", k)).toBe("ghr_secret");
  });

  it("seals with a fresh nonce each time", () => {
    expect(sealToken("x", "b", k)).not.toBe(sealToken("x", "b", k));
  });

  it("opens nothing bound to another row", () => {
    expect(openToken(sealToken("t", "refresh:u1", k), "refresh:u2", k)).toBeNull();
  });

  it("opens nothing without the key, with another key id or another key", () => {
    const sealed = sealToken("t", "b", k);
    expect(openToken(sealed, "b", null)).toBeNull();
    expect(openToken(sealed, "b", { ...k, id: "v2" })).toBeNull();
    expect(openToken(sealed, "b", { id: "v1", key: Buffer.alloc(32, 1) })).toBeNull();
  });

  it("opens nothing from a missing, malformed or tampered value", () => {
    expect(openToken(null, "b", k)).toBeNull();
    expect(openToken(undefined, "b", k)).toBeNull();
    expect(openToken("v1.onlynonce", "b", k)).toBeNull();
    const [id, nonce, body] = sealToken("t", "b", k).split(".");
    const flipped = Buffer.from(body ?? "", "base64");
    flipped.writeUInt8(flipped.readUInt8(0) ^ 1, 0);
    expect(openToken(`${id}.${nonce}.${flipped.toString("base64")}`, "b", k)).toBeNull();
    expect(openToken(`${id}.${nonce}.AA==`, "b", k)).toBeNull();
  });
});
