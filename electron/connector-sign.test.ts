// Main's copy of what a Mac signs for weft.zip's connectors (electron/connector-sign.cjs), held byte for byte to
// lib/connector-messages.ts, which weft.zip checks the signatures against.
import { describe, expect, it } from "vitest";
import * as shared from "../lib/connector-messages";
import sign from "./connector-sign.cjs";

describe("connector-sign.cjs", () => {
  it("builds every message exactly as lib/connector-messages.ts does", () => {
    const settings = { scope: "project" as const, approval: "card" as const, lifetime: "8h" as const, asks: ["protected_push" as const] };
    const grant = { userId: "u1", workerId: "w1", connector: "github", settings, nonce: "n", issuedAt: 5, prevEpoch: 2 };
    expect(sign.grantMessage(grant)).toBe(shared.grantMessage(grant));
    expect(sign.grantMessage({ ...grant, settings: { ...settings, asks: [] } })).toBe(shared.grantMessage({ ...grant, settings: { ...settings, asks: [] } }));
    const allow = { userId: "u1", grantId: "g1", kind: "card" as const, subject: "c\n1", nonce: "n", issuedAt: 5 };
    expect(sign.allowMessage(allow)).toBe(shared.allowMessage(allow));
    const worker = { userId: "u1", workerId: "w1", signKey: "s", boxKey: "b" };
    expect(sign.workerMessage(worker)).toBe(shared.workerMessage(worker));
    const start = { userId: "u1", workerId: "w1", cardId: "c1", folder: "ling", repo: "ada/ling", issuedAt: 5 };
    expect(sign.startMessage(start)).toBe(shared.startMessage(start));
    const signer = { userId: "u1", key: "k", name: "Ada's \"Mac\"", issuedAt: 5 };
    expect(sign.signerMessage(signer)).toBe(shared.signerMessage(signer));
    const endorse = { userId: "u1", key: "k", by: "b", issuedAt: 5 };
    expect(sign.endorseMessage(endorse)).toBe(shared.endorseMessage(endorse));
  });

  it("signs a grant over sorted asks, so the same yes reads the same however it was listed", () => {
    const base = { userId: "u1", workerId: "w1", connector: "github", nonce: "n", issuedAt: 5, prevEpoch: 0 };
    const two = ["protected_push", "a"] as unknown as shared.GrantStatement["settings"]["asks"];
    const settings = { scope: "project" as const, approval: "worker" as const, lifetime: "revoked" as const };
    expect(shared.grantMessage({ ...base, settings: { ...settings, asks: two } })).toBe(shared.grantMessage({ ...base, settings: { ...settings, asks: [...two].reverse() } }));
  });
});
