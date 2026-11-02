import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as cjs from "../electron/worker-seal.cjs";
import { fingerprint } from "../electron/worker-pins.cjs";
import { askMessage as mainAskMessage } from "../electron/worker-secret.cjs";
import { askMessage, newNonce, openedUse, sameNames, secretUseBody, secretUseMessage, secretUsePurpose } from "./secret-use";
import { newSealKeys, open, sealFingerprint } from "./worker-seal";

const NONCE = "a".repeat(64);
const SEALED = { v: 1, epk: "QQ==", iv: "QQ==", ct: "QQ==", tag: "QQ==" };
const use = { v: 1, card: "c1", nonce: NONCE, command: "npm run job", names: ["A"], environment: "development", expiresAt: 5, values: { A: "x" } };

describe("secretUsePurpose", () => {
  it("binds the card, the nonce and the command's hash, the same as main's", () => {
    const purpose = secretUsePurpose("c1", NONCE, "npm run job");
    expect(purpose).toMatch(/^secret-use:c1:a{64}:[0-9a-f]{64}$/);
    expect(cjs.secretUsePurpose("c1", NONCE, "npm run job")).toBe(purpose);
    expect(secretUsePurpose("c1", NONCE, "npm run job2")).not.toBe(purpose);
  });
});

describe("the messages both sides sign", () => {
  it("are the same on the worker and in main", () => {
    const a = { nonce: NONCE, command: "npm run job", names: ["A"], environment: "development", remote: "r", cwd: ".", script: undefined, expiresAt: 5 };
    expect(askMessage("c1", "box", a)).toBe(mainAskMessage("c1", "box", a));
    expect(askMessage("c1", "box", { ...a, script: "job: x" })).toBe(mainAskMessage("c1", "box", { ...a, script: "job: x" }));
    expect(askMessage("c1", "box", a)).not.toBe(askMessage("c1", "other box", a));
    expect(secretUseMessage("c1", NONCE, SEALED as never)).toBe(cjs.secretUseMessage("c1", NONCE, SEALED));
    expect(secretUseMessage("c1", NONCE, SEALED as never)).toBe(`weft-secret-use-v1\nc1\n${NONCE}\nQQ==\nQQ==\nQQ==\nQQ==`);
  });

  it("fingerprints a box key the same as main's pins", () => {
    const { publicKey } = newSealKeys();
    expect(sealFingerprint(publicKey)).toBe(fingerprint(publicKey));
  });
});

describe("main's seal", () => {
  it("opens with lib's open under the same purpose, and not under another", () => {
    const keys = newSealKeys();
    const sealed = cjs.seal(keys.publicKey, "hello", "p1");
    expect(open(keys, sealed, "p1")).toBe("hello");
    expect(() => open(keys, sealed, "p2")).toThrow();
    expect(() => open(newSealKeys(), sealed, "p1")).toThrow();
  });
});

describe("newNonce", () => {
  it("is 32 random bytes as hex", () => {
    expect(newNonce(randomBytes)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("secretUseBody", () => {
  it("reads a card, a nonce and a sealed payload", () => {
    expect(secretUseBody({ payload: { cardId: "c1", nonce: NONCE, sealed: SEALED } as never })).toEqual({ cardId: "c1", nonce: NONCE, sealed: SEALED, mac: null });
    expect(secretUseBody({ payload: { cardId: "c1", nonce: NONCE, sealed: SEALED, mac: { key: "k", sig: "s" } } as never })?.mac).toEqual({ key: "k", sig: "s" });
    expect(secretUseBody({ payload: { cardId: "c1", nonce: NONCE, sealed: SEALED, mac: { key: "", sig: "s" } } as never })?.mac).toBeNull();
    expect(secretUseBody({ payload: { cardId: "c1", nonce: NONCE, sealed: SEALED, mac: { key: "k" } } as never })?.mac).toBeNull();
  });

  it.each([null, [], { cardId: "", nonce: NONCE, sealed: SEALED }, { cardId: 1, nonce: NONCE, sealed: SEALED }, { cardId: "c1", nonce: "short", sealed: SEALED }, { cardId: "c1", nonce: 7, sealed: SEALED }, { cardId: "c1", nonce: NONCE, sealed: {} }])("refuses %j", (payload) => {
    expect(secretUseBody({ payload: payload as never })).toBeNull();
  });
});

describe("openedUse", () => {
  it("reads the plaintext main seals", () => {
    expect(openedUse(JSON.stringify(use))).toEqual({ card: "c1", nonce: NONCE, command: "npm run job", names: ["A"], environment: "development", expiresAt: 5, values: { A: "x" } });
  });

  it.each([
    ["not json", "{"],
    ["not an object", "[]"],
    ["another version", JSON.stringify({ ...use, v: 2 })],
    ["no card", JSON.stringify({ ...use, card: 1 })],
    ["no nonce", JSON.stringify({ ...use, nonce: null })],
    ["no command", JSON.stringify({ ...use, command: 3 })],
    ["no expiry", JSON.stringify({ ...use, expiresAt: "soon" })],
    ["bad names", JSON.stringify({ ...use, names: ["no-dash"] })],
    ["no names", JSON.stringify({ ...use, names: [] })],
    ["a bad environment", JSON.stringify({ ...use, environment: "staging" })],
    ["values not an object", JSON.stringify({ ...use, values: "x" })],
    ["a value not a string", JSON.stringify({ ...use, values: { A: 1 } })],
  ])("refuses %s", (_what, text) => {
    expect(openedUse(text)).toBeNull();
  });
});

describe("sameNames", () => {
  it("compares as sets of the same length", () => {
    expect(sameNames(["A", "B"], ["B", "A"])).toBe(true);
    expect(sameNames(["A"], ["A", "B"])).toBe(false);
    expect(sameNames(["A", "C"], ["A", "B"])).toBe(false);
  });
});
