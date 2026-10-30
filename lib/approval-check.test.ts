import { beforeAll, describe, expect, it, vi } from "vitest";
import { approvalProblem, UNSIGNED_REFUSED, type ApprovalDeps } from "./approval-check";
import { approvalMessage, APPROVAL_MAX_SKEW_MS } from "./approval-sig";
import type { AnswerPayload } from "./cloud-commands";
import { sodium, type Sodium } from "./sodium";
import type { PendingPermission } from "./types";

let s: Sodium;
beforeAll(async () => {
  s = await sodium();
});

const answer: AnswerPayload = { cardId: "c", pendingId: "p", allow: true };
const permission = { id: "p", toolName: "Bash", title: "Run", input: {} } as PendingPermission;
const command = (auth?: unknown) => ({ org_id: "o", target_device: "m", payload: { ...answer, ...(auth ? { auth } : {}) } });
const deps = (over: Partial<ApprovalDeps> = {}) => ({ verify: vi.fn(() => Promise.resolve({ ok: true })), approvers: vi.fn(() => Promise.resolve(1)), webApprovals: false, now: 10_000, ...over });

describe("signed answers", () => {
  it("go through when main verifies the exact message", async () => {
    const d = deps();
    expect(await approvalProblem(command({ device: "phone", issuedAt: 9_000, sig: "sig" }), { ...answer, answers: { q: "a" } }, permission, d)).toBeNull();
    expect(d.verify).toHaveBeenCalledWith({
      device: "phone",
      sig: "sig",
      message: approvalMessage(s, { orgId: "o", macDevice: "m", cardId: "c", pendingId: "p", allow: true, issuedAt: 9_000, answers: { q: "a" } }),
    });
  });
  it("are refused with main's reason, or a default", async () => {
    expect(await approvalProblem(command({ device: "x", issuedAt: 10_000, sig: "s" }), answer, permission, deps({ verify: () => Promise.resolve({ ok: false, reason: "nope" }) }))).toBe("nope");
    expect(await approvalProblem(command({ device: "x", issuedAt: 10_000, sig: "s" }), answer, permission, deps({ verify: () => Promise.resolve({ ok: false }) }))).toMatch(/signature/);
  });
  it("are refused when stale", async () => {
    const d = deps();
    expect(await approvalProblem(command({ device: "x", issuedAt: 10_000 - APPROVAL_MAX_SKEW_MS - 1, sig: "s" }), answer, permission, d)).toMatch(/too old/);
    expect(d.verify).not.toHaveBeenCalled();
  });
});

describe("unsigned answers", () => {
  it("refuse an Allow once a phone is paired", async () => {
    expect(await approvalProblem(command(), answer, permission, deps())).toBe(UNSIGNED_REFUSED);
    expect(await approvalProblem(command({ device: 1 }), answer, null, deps())).toBe(UNSIGNED_REFUSED);
  });
  it("let an Allow through with no phone, or when the web may approve", async () => {
    expect(await approvalProblem(command(), answer, permission, deps({ approvers: () => Promise.resolve(0) }))).toBeNull();
    expect(await approvalProblem(command(), answer, permission, deps({ webApprovals: true }))).toBeNull();
  });
  it("never block a Deny or a question's answers", async () => {
    const d = deps();
    expect(await approvalProblem(command(), { ...answer, allow: false }, permission, d)).toBeNull();
    expect(await approvalProblem(command(), answer, { ...permission, questions: [{ question: "q" }] } as PendingPermission, d)).toBeNull();
    expect(await approvalProblem(command(), answer, { ...permission, elicitation: {} } as PendingPermission, d)).toBeNull();
    expect(await approvalProblem({ ...command(), payload: null as never }, { ...answer, allow: false }, permission, d)).toBeNull();
    expect(d.approvers).not.toHaveBeenCalled();
  });
});
