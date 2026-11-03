// The desktop board's signed Allow on a worker card (lib/answer-signer.ts): only an Allow on a permission request asks
// main to sign, the board sends ids only, and what comes back is the auth a worker reads.
import { afterEach, describe, expect, it, vi } from "vitest";
import { needsSignature, signedAnswer } from "./answer-signer";
import type { Card } from "./types";

const card = (pending: unknown) => ({ id: "c1", pending }) as Pick<Card, "id" | "pending">;
const permission = { id: "p1", toolName: "Bash", input: { command: "ls" } };

afterEach(() => vi.unstubAllGlobals());

describe("needsSignature", () => {
  it("is an Allow on a permission request only", () => {
    expect(needsSignature(card(permission), true)).toBe(true);
    expect(needsSignature(card(permission), false)).toBe(false);
    expect(needsSignature(card(null), true)).toBe(false);
    expect(needsSignature(card({ ...permission, questions: [{ question: "?" }] }), true)).toBe(false);
    expect(needsSignature(card({ ...permission, elicitation: { message: "m" } }), true)).toBe(false);
  });
});

describe("signedAnswer", () => {
  it("asks main with ids, the decision, answers and grant, and keeps only what the worker reads", async () => {
    const sign = vi.fn(() => Promise.resolve({ device: "mac-1", issuedAt: 5, sig: "c2ln", publicKey: "k" }));
    vi.stubGlobal("window", { weft: { approval: { sign } } });
    expect(await signedAnswer(card(permission), true)).toEqual({ device: "mac-1", issuedAt: 5, sig: "c2ln" });
    expect(sign).toHaveBeenLastCalledWith({ cardId: "c1", pendingId: "p1", allow: true });
    await signedAnswer(card(permission), true, { answers: { a: "b" }, grant: "always" });
    expect(sign).toHaveBeenLastCalledWith({ cardId: "c1", pendingId: "p1", allow: true, answers: { a: "b" }, grant: "always" });
  });

  it("throws when Touch ID is refused", async () => {
    vi.stubGlobal("window", { weft: { approval: { sign: () => Promise.resolve(null) } } });
    await expect(signedAnswer(card(permission), true)).rejects.toThrow("Not approved");
  });

  it("asks nothing for a Deny, nothing waiting, or without the desktop app", async () => {
    const sign = vi.fn();
    vi.stubGlobal("window", { weft: { approval: { sign } } });
    expect(await signedAnswer(card(permission), false)).toBeUndefined();
    expect(await signedAnswer(card(null), true)).toBeUndefined();
    expect(sign).not.toHaveBeenCalled();
    vi.stubGlobal("window", {});
    expect(await signedAnswer(card(permission), true)).toBeUndefined();
    vi.unstubAllGlobals();
    expect(await signedAnswer(card(permission), true)).toBeUndefined();
  });
});
