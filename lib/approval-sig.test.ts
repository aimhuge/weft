import { beforeAll, describe, expect, it } from "vitest";
import { approvalMessage, canonicalAnswers, freshEnough, readApprovalAuth, signApproval, verifyApproval, APPROVAL_MAX_SKEW_MS, type ApprovalFields } from "./approval-sig";
import { b64, sodium, type Sodium } from "./sodium";

let s: Sodium;
let pub: string;
let priv: string;
beforeAll(async () => {
  s = await sodium();
  const pair = s.crypto_sign_keypair();
  pub = b64(s, pair.publicKey);
  priv = b64(s, pair.privateKey);
});

const fields: ApprovalFields = { orgId: "o", macDevice: "m", cardId: "c", pendingId: "p", allow: true, issuedAt: 1000 };

describe("approvalMessage", () => {
  it("lists every field, in order", () => {
    expect(approvalMessage(s, fields)).toBe("weft-approval-v1\no\nm\nc\np\nallow\n1000\n-");
    expect(approvalMessage(s, { ...fields, allow: false, answers: {} }).split("\n")[5]).toBe("deny");
  });
  it("hashes answers canonically", () => {
    const a = approvalMessage(s, { ...fields, answers: { b: "2", a: "1" } });
    expect(a).toBe(approvalMessage(s, { ...fields, answers: { a: "1", b: "2" } }));
    expect(a.split("\n")[7]).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalAnswers({ b: "2", a: "1" })).toBe('{"a":"1","b":"2"}');
  });
});

describe("signatures", () => {
  it("verifies its own and refuses any change", () => {
    const sig = signApproval(s, approvalMessage(s, fields), priv);
    expect(verifyApproval(s, approvalMessage(s, fields), sig, pub)).toBe(true);
    for (const change of [{ allow: false }, { cardId: "x" }, { pendingId: "x" }, { macDevice: "x" }, { orgId: "x" }, { issuedAt: 1001 }, { answers: { a: "1" } }])
      expect(verifyApproval(s, approvalMessage(s, { ...fields, ...change }), sig, pub)).toBe(false);
  });
  it("refuses garbage instead of throwing", () => {
    expect(verifyApproval(s, "m", "!!", pub)).toBe(false);
    expect(verifyApproval(s, "m", b64(s, new Uint8Array(64)), "short")).toBe(false);
  });
});

describe("freshEnough", () => {
  it("takes five minutes either way", () => {
    expect(freshEnough(1000, 1000 + APPROVAL_MAX_SKEW_MS)).toBe(true);
    expect(freshEnough(1000, 1001 + APPROVAL_MAX_SKEW_MS)).toBe(false);
    expect(freshEnough(1000 + APPROVAL_MAX_SKEW_MS + 1, 1000)).toBe(false);
    expect(freshEnough(Number.NaN, 0)).toBe(false);
  });
});

describe("readApprovalAuth", () => {
  it("reads a well-typed auth only", () => {
    expect(readApprovalAuth({ device: "d", issuedAt: 1, sig: "s" })).toEqual({ device: "d", issuedAt: 1, sig: "s" });
    for (const bad of [null, "x", { device: "d", issuedAt: "1", sig: "s" }, { device: "", issuedAt: 1, sig: "s" }, { device: "d", issuedAt: 1, sig: "s".repeat(201) }])
      expect(readApprovalAuth(bad)).toBeNull();
  });
});
