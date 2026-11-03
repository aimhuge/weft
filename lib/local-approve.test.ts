// This Mac's rule for an answer to its own card from its own window (lib/local-approve.ts): an Allow on a phone-only ask
// needs main's signature over this Mac's id and the workspace "local"; any signature sent is checked; the rest goes
// through as before. Signed for real with libsodium, and checked by a stand-in for main's /pairing/verify.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { approvalProblem } from "./approval-check";
import { approvalMessage, signApproval, verifyApproval } from "./approval-sig";
import { LOCAL_GONE, LOCAL_MALFORMED, LOCAL_ORG, LOCAL_UNSIGNED, localApprovalProblem, type LocalApproveDeps } from "./local-approve";
import { sodium, type Sodium } from "./sodium";
import type { Card, PendingPermission } from "./types";

let s: Sodium;
let keys: { publicKey: string; privateKey: string };
beforeAll(async () => {
  s = await sodium();
  const pair = s.crypto_sign_keypair();
  keys = { publicKey: s.to_base64(pair.publicKey, s.base64_variants.ORIGINAL), privateKey: s.to_base64(pair.privateKey, s.base64_variants.ORIGINAL) };
});

const NOW = 1_000_000;
const risky = { id: "p1", toolName: "Bash", title: "Run", input: { command: "claude --dangerously-skip-permissions" } } as PendingPermission;
const plain = { ...risky, input: { command: "ls" } } as PendingPermission;
const card = (pending: PendingPermission | null = risky) => ({ id: "c1", pending: pending ?? undefined }) as Pick<Card, "id" | "pending">;

// Main: this Mac's own key under its own id.
const deps = (over: Partial<LocalApproveDeps> = {}): LocalApproveDeps => ({
  verify: vi.fn(({ device, message, sig }: { device: string; message: string; sig: string }) =>
    Promise.resolve(device === "mac-1" && verifyApproval(s, message, sig, keys.publicKey) ? { ok: true } : { ok: false, reason: "not this Mac's" }),
  ),
  self: "mac-1",
  now: NOW,
  ...over,
});

// What electron/approval-sign.cjs signs for this Mac's card.
const signed = (over: Partial<Parameters<typeof approvalMessage>[1]> = {}) => {
  const fields = { orgId: LOCAL_ORG, macDevice: "mac-1", cardId: "c1", pendingId: "p1", allow: true, issuedAt: NOW - 1_000, ...over };
  return { device: "mac-1", issuedAt: fields.issuedAt, sig: signApproval(s, approvalMessage(s, fields), keys.privateKey) };
};

describe("localApprovalProblem", () => {
  it("lets a plain Allow, a Deny and a question's answers through unsigned, as before", async () => {
    const d = deps();
    expect(await localApprovalProblem(card(plain), { allow: true, pendingId: "p1" }, d)).toBeNull();
    expect(await localApprovalProblem(card(risky), { allow: false, pendingId: "p1" }, d)).toBeNull();
    expect(await localApprovalProblem(card({ ...risky, questions: [{ question: "?" }] } as never), { allow: true, answers: { "?": "y" } }, d)).toBeNull();
    expect(await localApprovalProblem(card(null), { allow: true }, d)).toBeNull();
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses an unsigned Allow on a phone-only ask, and a null auth counts as none", async () => {
    expect(await localApprovalProblem(card(), { allow: true, pendingId: "p1" }, deps())).toBe(LOCAL_UNSIGNED);
    expect(await localApprovalProblem(card(), { allow: true, pendingId: "p1", auth: null }, deps())).toBe(LOCAL_UNSIGNED);
  });

  it("takes main's signature over this Mac's id, the workspace \"local\" and exactly this request", async () => {
    const d = deps();
    expect(await localApprovalProblem(card(), { allow: true, pendingId: "p1", auth: signed() }, d)).toBeNull();
    expect(d.verify).toHaveBeenCalledWith(expect.objectContaining({ device: "mac-1" }));
    // Answers ride in the message; non-text answers are left out of it.
    expect(await localApprovalProblem(card(), { allow: true, pendingId: "p1", answers: { a: "b" }, auth: signed({ answers: { a: "b" } }) }, deps())).toBeNull();
    expect(await localApprovalProblem(card(), { allow: true, pendingId: "p1", answers: { a: 1 }, auth: signed() }, deps())).toBeNull();
    // A plain ask may carry one too, and it's checked.
    expect(await localApprovalProblem(card(plain), { allow: true, pendingId: "p1", auth: signed({ cardId: "c2" }) }, deps())).toBe("not this Mac's");
  });

  it("refuses a signature for another card, request, decision, host or a real workspace", async () => {
    for (const over of [{ cardId: "c2" }, { allow: false }, { macDevice: "mac-2" }, { orgId: "org-1" }]) {
      expect(await localApprovalProblem(card(), { allow: true, pendingId: "p1", auth: signed(over) }, deps())).toBe("not this Mac's");
    }
  });

  it("refuses a request that isn't the one waiting, a stale signature and a malformed or passkey auth", async () => {
    expect(await localApprovalProblem(card(), { allow: true, pendingId: "p0", auth: signed({ pendingId: "p0" }) }, deps())).toBe(LOCAL_GONE);
    expect(await localApprovalProblem(card(), { allow: true, auth: signed() }, deps())).toBe(LOCAL_GONE);
    expect(await localApprovalProblem(card(null), { allow: true, pendingId: "p1", auth: signed() }, deps())).toBe(LOCAL_GONE);
    expect(await localApprovalProblem(card(), { allow: true, pendingId: "p1", auth: signed({ issuedAt: NOW - 10 * 60_000 }) }, deps())).toMatch(/too old/);
    expect(await localApprovalProblem(card(), { allow: true, pendingId: "p1", auth: { device: 1 } }, deps())).toBe(LOCAL_MALFORMED);
    expect(await localApprovalProblem(card(), { allow: true, pendingId: "p1", auth: { kind: "webauthn", device: "b1", credId: "Y3JlZA", issuedAt: NOW, authenticatorData: "YQ", clientDataJSON: "YQ", signature: "YQ" } }, deps())).toBe(LOCAL_MALFORMED);
  });

  it("makes a signature that never checks out as a network answer, which names the real workspace", async () => {
    const auth = signed();
    const verify = deps().verify;
    const problem = await approvalProblem({ org_id: "org-1", target_device: "mac-1", payload: { auth } as never }, { cardId: "c1", pendingId: "p1", allow: true }, risky, {
      verify,
      approvers: () => Promise.resolve(0),
      webApprovals: false,
      now: NOW,
    });
    expect(problem).toBe("not this Mac's");
  });
});
