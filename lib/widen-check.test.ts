import { describe, expect, it, vi } from "vitest";
import { BIDI_REFUSED } from "./approval-passkey";
import { PHONE_ONLY } from "./passkey-phone-only";
import { widenMessage, WIDEN_TTL_MS } from "./widen";
import { NO_PASSKEY_HERE, PASSKEY_NO_SHELL, PASSKEY_TOO_WIDE, STALE, USED, widenProblem, type WidenDeps } from "./widen-check";
import { nonceBook } from "./widen-nonces";

const NOW = 1_000_000;
const nonce = "abcdefghijklmnop";
const ed = { kind: "ed25519", device: "mac", issuedAt: NOW, nonce, sig: "c2ln" };
const wa = { kind: "webauthn", device: "b", credId: "cred", issuedAt: NOW, nonce, authenticatorData: "YQ", clientDataJSON: "Yg", signature: "Yw" };
const target = { card: "c1", verb: "card.update" as const, change: { cwd: "app" }, args: { body: { cwd: "app" } } };

function deps(over: Partial<WidenDeps> = {}) {
  const saved: Record<string, number> = {};
  const nonces = nonceBook({ load: () => ({ ...saved }), save: (n) => Object.assign(saved, n) }, () => NOW);
  return {
    host: "h1",
    now: NOW,
    nonces,
    verify: vi.fn(() => Promise.resolve({ ok: true })),
    passkey: vi.fn(() => Promise.resolve({ ok: true })),
    ...over,
  } satisfies WidenDeps;
}

describe("widenProblem", () => {
  it("says the host's own refusal without an approval", async () => {
    expect(await widenProblem(target, undefined, "no", deps())).toBe("no");
    expect(await widenProblem(target, { kind: "x" }, "no", deps())).toBe("no");
  });

  it("checks an Ed25519 approval over the message this host rebuilds, then spends its nonce", async () => {
    const d = deps();
    expect(await widenProblem(target, ed, "no", d)).toBeNull();
    expect(d.verify).toHaveBeenCalledWith({ device: "mac", sig: "c2ln", message: widenMessage({ host: "h1", ...target, nonce, issuedAt: NOW }) });
    expect(await widenProblem(target, ed, "no", d)).toBe(USED);
  });

  it("binds the rest of the command: the same approval over other args is another message", async () => {
    const d = deps();
    expect(await widenProblem({ ...target, args: { body: { cwd: "app", permissionMode: "auto" } } }, ed, "no", d)).toBeNull();
    const signed = widenMessage({ host: "h1", ...target, nonce, issuedAt: NOW });
    expect(d.verify).not.toHaveBeenCalledWith(expect.objectContaining({ message: signed }));
  });

  it("refuses a stale one, a failed signature, and one that loses a race for its nonce", async () => {
    expect(await widenProblem(target, { ...ed, issuedAt: NOW - WIDEN_TTL_MS - 1 }, "no", deps())).toBe(STALE);
    expect(await widenProblem(target, ed, "no", deps({ verify: () => Promise.resolve({ ok: false, reason: "bad" }) }))).toBe("bad");
    expect(await widenProblem(target, ed, "no", deps({ verify: () => Promise.resolve({ ok: false }) }))).toMatch(/doesn't check out/);
    const d = deps();
    const racing = { ...d, verify: () => (d.nonces.take(nonce, NOW + 1), Promise.resolve({ ok: true })) };
    expect(await widenProblem(target, ed, "no", racing)).toBe(USED);
  });

  it("refuses text-direction characters and what the host won't hold", async () => {
    expect(await widenProblem({ ...target, change: { readScope: { a: ["x\u202e"] } } }, ed, "no", deps())).toBe(BIDI_REFUSED);
    expect(await widenProblem(target, ed, "no", deps({ confine: () => "not here" }))).toBe("not here");
    expect(await widenProblem({ ...target, change: { readScope: [3, null] } }, { ...ed, nonce: "zyxwvutsrqponmlk" }, "no", deps())).toBeNull();
    expect(await widenProblem(target, ed, "no", deps({ confine: () => null }))).toBeNull();
  });

  it("takes a passkey for a folder, an agent or a plain shell line, never skipping prompts or a grant", async () => {
    const d = deps();
    expect(await widenProblem(target, wa, "no", d)).toBeNull();
    expect(d.passkey).toHaveBeenCalledWith(expect.objectContaining({ device: "b", credId: "cred", authenticatorData: "YQ" }));
    expect(await widenProblem({ ...target, change: { permissionMode: "bypassPermissions" } }, wa, "no", deps())).toBe(PASSKEY_TOO_WIDE);
    expect(await widenProblem({ ...target, change: { readScope: "/x" } }, wa, "no", deps())).toBe(PASSKEY_TOO_WIDE);
    // A "!" line from a passkey is a shell for whoever holds it: only where the host lets the web approve.
    expect(await widenProblem({ ...target, verb: "card.shell", change: { shell: "ls" } }, wa, "no", deps())).toBe(PASSKEY_NO_SHELL);
    expect(await widenProblem({ ...target, verb: "card.schedule", change: { schedule: "!ls" } }, wa, "no", deps())).toBe(PASSKEY_NO_SHELL);
    expect(await widenProblem({ ...target, verb: "card.shell", change: { shell: "cat ~/.claude/settings.json" } }, wa, "no", deps({ passkeyShell: true }))).toBe(PHONE_ONLY);
    expect(await widenProblem({ ...target, verb: "card.schedule", change: { schedule: "!ls" } }, wa, "no", deps({ passkeyShell: true }))).toBeNull();
    expect(await widenProblem(target, wa, "no", deps({ passkey: undefined }))).toBe(NO_PASSKEY_HERE);
    expect(await widenProblem(target, wa, "no", deps({ passkey: () => Promise.resolve({ ok: false, reason: "counter" }) }))).toBe("counter");
  });
});
