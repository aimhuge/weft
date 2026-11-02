import { describe, expect, it, vi } from "vitest";
import { TERMINAL_REFUSAL } from "./host-line-protocol";
import { widenMessage } from "./widen";
import { nonceBook } from "./widen-nonces";
import { placeUpdate, terminalAllow, workerConfine, workerWidenCheck, workerWidenDeps, type WorkerWiden } from "./worker-widen";

const NOW = 2_000_000;
const nonce = "abcdefghijklmnop";

const nameFolder = vi.fn();

function widen(over: Partial<WorkerWiden> = {}): WorkerWiden {
  return {
    host: "w1",
    signers: { verify: vi.fn(() => Promise.resolve({ ok: true })), verifyPasskey: vi.fn(() => Promise.resolve({ ok: true })), endorse: vi.fn() },
    nonces: nonceBook({ load: () => ({}), save: () => {} }, () => NOW),
    projects: () => ["app", "site"],
    root: "/w",
    projectPath: (f) => `/w/${f}`,
    nameFolder,
    now: () => NOW,
    ...over,
  };
}

describe("workerConfine", () => {
  it("keeps a folder or terminal to the worker's projects and a read grant under its root", () => {
    const w = widen();
    expect(workerConfine(w, { cwd: "app", terminal: "site" })).toBeNull();
    expect(workerConfine(w, { cwd: "/etc" })).toMatch(/isn't a project/);
    expect(workerConfine(w, { terminal: "../x" })).toMatch(/isn't a project/);
    expect(workerConfine(w, { readScope: "/w/app/docs" })).toBeNull();
    for (const readScope of ["/etc", "w/app", 3, "/w/../etc"]) expect(workerConfine(w, { readScope })).toMatch(/own projects/);
    expect(workerConfine(w, { shell: "ls" })).toBeNull();
  });
});

describe("workerWidenCheck", () => {
  it("checks against the worker's own id, pins and nonces", async () => {
    const w = widen();
    const auth = { kind: "ed25519", device: "mac", issuedAt: NOW, nonce, sig: "c2ln" };
    expect(await workerWidenCheck(w)({ card: "c", verb: "card.update", change: { cwd: "app" } }, auth, "no")).toBeNull();
    expect(w.signers.verify).toHaveBeenCalledWith(expect.objectContaining({ message: widenMessage({ host: "w1", card: "c", verb: "card.update", change: { cwd: "app" }, nonce, issuedAt: NOW }) }));
    const pk = { kind: "webauthn", device: "b", credId: "cred", issuedAt: NOW, nonce: "qrstuvwxyzabcdef", authenticatorData: "YQ", clientDataJSON: "Yg", signature: "Yw" };
    expect(await workerWidenCheck(w)({ card: "c", verb: "card.update", change: { agent: "b" } }, pk, "no")).toBeNull();
    expect(w.signers.verifyPasskey).toHaveBeenCalled();
    expect(workerWidenDeps(widen({ now: undefined })).now).toBeGreaterThan(0);
  });
});

describe("placeUpdate", () => {
  it("runs a new folder in its checkout and files the card under it, and leaves anything else alone", () => {
    const w = widen();
    const placed = placeUpdate(w, "card.update", { id: "c", body: { cwd: "site", title: "t" } }, { id: "c" });
    expect(placed.args).toEqual({ id: "c", body: { cwd: "/w/site", title: "t" } });
    placed.after();
    expect(nameFolder).toHaveBeenCalledWith("c", "site");
    const args = { id: "c", body: { title: "t" } };
    expect(placeUpdate(w, "card.update", args, { id: "c" }).args).toBe(args);
    expect(placeUpdate(w, "card.stop", { id: "c" }, { id: "c" }).args).toEqual({ id: "c" });
    placeUpdate(w, "card.stop", { id: "c" }, { id: "c" }).after();
  });
});

describe("terminalAllow", () => {
  it("answers the project's checkout once the approval checks out, and throws the refusal otherwise", async () => {
    const allow = terminalAllow(widen());
    await expect(allow("app", { kind: "ed25519", device: "m", issuedAt: NOW, nonce, sig: "c2ln" })).resolves.toBe("/w/app");
    await expect(allow("app", undefined)).rejects.toThrow(TERMINAL_REFUSAL);
  });
});
