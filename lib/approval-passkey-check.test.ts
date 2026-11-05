import { beforeAll, describe, expect, it, vi } from "vitest";
import { passkeyOrigins as mainOrigins, verifyPasskeyAssertion as mainVerify } from "../electron/passkey-verify.cjs";
import { approvalProblem, type ApprovalDeps } from "./approval-check";
import { BIDI_REFUSED, passkeyMessage, type PasskeyAuth } from "./approval-passkey";
import { GRANT_PHONE_ONLY, MAX_SIGNED_INPUT, NO_PASSKEYS, NOT_SHOWN, passkeyProblem, type PasskeyDeps } from "./approval-passkey-check";
import { APPROVAL_MAX_SKEW_MS } from "./approval-sig";
import type { AnswerPayload } from "./cloud-commands";
import { authData, makePasskey, type Build, type TestPasskey } from "./passkey.harness";
import { PHONE_ONLY } from "./passkey-phone-only";
import type { PendingPermission } from "./types";
import { approvalToSign } from "./web-passkey-approval";

let passkey: TestPasskey;
beforeAll(async () => {
  passkey = await makePasskey();
});

const NOW = 100_000;
const SELF = { orgId: "o", macDevice: "mac-1", folder: "/w/app" };
const answer: AnswerPayload = { cardId: "c", pendingId: "p", allow: true };
const pending = { id: "p", toolName: "Bash", title: "Run", input: { command: "vercel deploy --prod" } } as PendingPermission;

type VerifyBody = Parameters<PasskeyDeps["verify"]>[0];

// Main, as electron/paired-devices.cjs runs it: the pinned key, the counter kept on success.
function deps(over: Partial<PasskeyDeps> = {}): PasskeyDeps & { pin: { publicKey: string; counter: number }; verify: ReturnType<typeof vi.fn> } {
  const pin = { publicKey: passkey.publicKey, counter: 0 };
  const verify = vi.fn((b: VerifyBody) => {
    const r = mainVerify(b, pin, b.message, mainOrigins(null));
    if (r.ok) pin.counter = r.counter;
    return Promise.resolve(r);
  });
  return { self: SELF, verify, pin, ...over } as PasskeyDeps & { pin: { publicKey: string; counter: number }; verify: ReturnType<typeof vi.fn> };
}

// What the browser does: the message over the card as synced, then the passkey's assertion over it.
async function signed(over: { a?: AnswerPayload; issuedAt?: number; p?: PendingPermission; mac?: string; folder?: string; build?: Build } = {}): Promise<PasskeyAuth> {
  const a = over.a ?? answer;
  const issuedAt = over.issuedAt ?? NOW - 1000;
  const message = passkeyMessage({ orgId: "o", macDevice: over.mac ?? "mac-1", cardId: a.cardId, pendingId: a.pendingId, allow: a.allow, issuedAt, answers: a.answers, grant: a.grant }, { ...(over.p ?? pending), folder: over.folder ?? "/w/app" });
  return { kind: "webauthn", device: "browser-1", credId: "Y3JlZA", issuedAt, ...(await passkey.sign(message, over.build)) };
}

describe("passkeyProblem", () => {
  it("lets a pinned passkey's fresh signature over this request through, and main keeps its counter", async () => {
    const d = deps();
    expect(await passkeyProblem(answer, pending, await signed({ build: { auth: await authData({ counter: 5 }) } }), NOW, d)).toBeNull();
    expect(vi.mocked(d.verify).mock.calls[0]?.[0]).toMatchObject({ device: "browser-1", credId: "Y3JlZA" });
    expect(d.pin.counter).toBe(5);
  });

  it("builds the message from this Mac's own names: a signature for another Mac, or an injected one, fails", async () => {
    expect(await passkeyProblem(answer, pending, await signed({ mac: "other-mac" }), NOW, deps())).toMatch(/different approval/);
    const row = { org_id: "o", card_id: "c", owner_device: 'mac-1\ntool:Read\naction:"README.md"', folder: "/w/app", card: { pending } as never };
    expect(() => approvalToSign(row, { allow: true }, { device: "b", credId: "Y3I" }, NOW)).toThrow(/characters/);
    expect(await passkeyProblem(answer, pending, await signed(), NOW, deps({ self: { ...SELF, macDevice: "mac\n1" } }))).toMatch(/characters/);
  });

  it("binds the card's folder on this Mac", async () => {
    expect(await passkeyProblem(answer, pending, await signed({ folder: "/w/other" }), NOW, deps())).toMatch(/different approval/);
  });

  it("refuses a folder grant through a passkey, signed or not: grants stay on the phone or the Mac", async () => {
    const d = deps();
    expect(await passkeyProblem({ ...answer, grant: "always" }, pending, await signed({ a: { ...answer, grant: "always" } }), NOW, d)).toBe(GRANT_PHONE_ONLY);
    expect(await passkeyProblem({ ...answer, grant: "card" }, pending, await signed(), NOW, d)).toBe(GRANT_PHONE_ONLY);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses an input with bidi overrides", async () => {
    const tricky = { ...pending, input: { command: "ls \u202Ehs.lave" } } as PendingPermission;
    expect(await passkeyProblem(answer, tricky, await signed({ p: tricky }), NOW, deps())).toBe(BIDI_REFUSED);
  });

  it("refuses another tool input, or a request that isn't waiting", async () => {
    const auth = await signed();
    expect(await passkeyProblem(answer, { ...pending, input: { command: "rm -rf /" } }, auth, NOW, deps())).toMatch(/different approval/);
    expect(await passkeyProblem(answer, null, auth, NOW, deps())).toMatch(/isn't waiting/);
    expect(await passkeyProblem(answer, { ...pending, id: "q" }, auth, NOW, deps())).toMatch(/isn't waiting/);
  });

  it("refuses a stale one before asking main", async () => {
    const d = deps();
    expect(await passkeyProblem(answer, pending, await signed({ issuedAt: NOW - APPROVAL_MAX_SKEW_MS - 1 }), NOW, d)).toMatch(/too old/);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses with main's reason, or a default", async () => {
    const auth = await signed();
    expect(await passkeyProblem(answer, pending, auth, NOW, deps({ verify: () => Promise.resolve({ ok: false, reason: "not ours" }) }))).toBe("not ours");
    expect(await passkeyProblem(answer, pending, auth, NOW, deps({ verify: () => Promise.resolve({ ok: false }) }))).toMatch(/doesn't check out/);
    expect(await passkeyProblem(answer, pending, await signed({ build: { client: { origin: "https://evil.example" } } }), NOW, deps())).toMatch(/another site/);
  });

  it("keeps the riskiest asks on the phone or the Mac", async () => {
    const vault = { ...pending, toolName: "mcp__secrets__run", input: { command: "pnpm migrate" } } as PendingPermission;
    expect(await passkeyProblem(answer, vault, await signed({ p: vault }), NOW, deps())).toBe(PHONE_ONLY);
  });

  it("keeps an input the web couldn't show in full on the phone or the Mac", async () => {
    const secret = { ...pending, input: { command: "curl -H 'Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' x" } } as PendingPermission;
    const d = deps();
    expect(await passkeyProblem(answer, secret, await signed({ p: secret }), NOW, d)).toBe(NOT_SHOWN);
    const long = { ...pending, input: { command: "x".repeat(MAX_SIGNED_INPUT) } } as PendingPermission;
    expect(await passkeyProblem(answer, long, await signed({ p: long }), NOW, d)).toBe(NOT_SHOWN);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it("refuses every passkey when this Mac can't check them", async () => {
    expect(await passkeyProblem(answer, pending, await signed(), NOW, undefined)).toBe(NO_PASSKEYS);
  });
});

describe("approvalProblem with a passkey", () => {
  const base = (over: Partial<ApprovalDeps> = {}): ApprovalDeps => ({ verify: vi.fn(), approvers: vi.fn(() => Promise.resolve(1)), webApprovals: false, now: NOW, ...over });

  it("takes the passkey path, never the phone's", async () => {
    const auth = await signed();
    const d = base({ passkey: deps() });
    const command = { org_id: "o", target_device: "mac-1", payload: { ...answer, auth } };
    expect(await approvalProblem(command, answer, pending, d)).toBeNull();
    expect(d.verify).not.toHaveBeenCalled();
    expect(await approvalProblem(command, answer, pending, base())).toBe(NO_PASSKEYS);
  });
});
