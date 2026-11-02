// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANCELLED, canSignWiden, endorsePasskeys, NO_SIGNER, refreshEndorsements, signedArgs, signWiden, withCreateWiden, workerFolderOf } from "./widen-signer";

const auth = { kind: "ed25519", device: "mac", issuedAt: 1, nonce: "abcdefghijklmnop", sig: "c2ln" };
const bridge = (widen?: unknown, endorse?: unknown) => ((window as unknown as { weft?: unknown }).weft = { approval: { widen, endorse } });

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

describe("signWiden", () => {
  it("asks main, and says when there's no signer or Touch ID was refused", async () => {
    expect(canSignWiden()).toBe(false);
    await expect(signWiden({ host: "w", card: "c", verb: "card.shell", change: { shell: "ls" }, args: { command: "ls" } })).rejects.toThrow(NO_SIGNER);
    const widen = vi.fn(() => Promise.resolve(auth));
    bridge(widen);
    expect(canSignWiden()).toBe(true);
    await expect(signWiden({ host: "w", card: "c", verb: "card.shell", change: { shell: "ls" }, args: { command: "ls" } })).resolves.toBe(auth);
    bridge(() => Promise.resolve(null));
    await expect(signWiden({ host: "w", card: "c", verb: "card.shell", change: { shell: "ls" }, args: { command: "ls" } })).rejects.toThrow(CANCELLED);
  });
});

describe("workerFolderOf", () => {
  it("names a worker card's folder as that worker does", () => {
    expect(workerFolderOf("w1", "worker://w1/site")).toBe("site");
    expect(workerFolderOf("w1", "site")).toBe("site");
    for (const bad of ["worker://w2/site", "/Users/me/site", "", 3]) expect(() => workerFolderOf("w1", bad)).toThrow(/another of that worker's projects/);
  });
});

describe("signedArgs", () => {
  it("signs exactly the widening, with the folder as the worker's project name", async () => {
    const widen = vi.fn(() => Promise.resolve(auth));
    bridge(widen);
    expect(await signedArgs("w1", "card.update", { id: "c", body: { cwd: "worker://w1/site", title: "t" } })).toEqual({ id: "c", body: { cwd: "site", title: "t" }, widen: auth });
    // The rest of the command (the title beside the folder) is bound too.
    expect(widen).toHaveBeenCalledWith({ host: "w1", card: "c", verb: "card.update", change: { cwd: "site" }, args: { body: { cwd: "site", title: "t" } } });
    const plain = { id: "c", body: { title: "t" } };
    expect(await signedArgs("w1", "card.update", plain)).toBe(plain);
  });

  it("sends a widening unsigned where there's no signer, for the worker to refuse", async () => {
    expect(await signedArgs("w1", "card.shell", { id: "c", command: "ls" })).toEqual({ id: "c", command: "ls" });
  });
});

describe("withCreateWiden", () => {
  it("signs a new worker thread's agent, folder and trimmed prompt, and leaves any other new thread alone", async () => {
    const widen = vi.fn(() => Promise.resolve(auth));
    bridge(widen);
    const input = { cwd: "worker://w1/app", agent: "builder", prompt: " go ", start: true, permissionMode: "auto", backend: "codex" };
    expect(await withCreateWiden(input)).toEqual({ ...input, widen: auth });
    const args = { prompt: "go", permissionMode: "auto", backend: "codex" };
    expect(widen).toHaveBeenCalledWith({ host: "w1", card: "", verb: "card.create", change: { create: { agent: "builder", folder: "app", prompt: "go" } }, args });
    await withCreateWiden({ cwd: "worker://w1/app", agent: "b", start: true });
    expect(widen).toHaveBeenLastCalledWith(expect.objectContaining({ change: { create: { agent: "b", folder: "app", prompt: "" } } }));
    for (const other of [{ cwd: "/local", agent: "b", start: true }, { cwd: "worker://w1/app", start: true }, { cwd: "worker://w1/app", agent: "b" }, {}]) expect(await withCreateWiden(other)).toBe(other);
  });
});

describe("endorsePasskeys", () => {
  it("asks main for the endorsements, and says when there's no signer", async () => {
    await expect(endorsePasskeys("w1")).rejects.toThrow(NO_SIGNER);
    const endorse = vi.fn(() => Promise.resolve([{ e: 1 }]));
    bridge(undefined, endorse);
    await expect(endorsePasskeys("w1", true)).resolves.toEqual([{ e: 1 }]);
    expect(endorse).toHaveBeenCalledWith({ worker: "w1", revoke: true });
  });
});

describe("refreshEndorsements", () => {
  it("asks main for every worker's narrowed set, and is empty without the desktop app", async () => {
    expect(await refreshEndorsements()).toEqual([]);
    const sets = [{ worker: "w1", endorsements: [{ e: 1 }] }];
    (window as unknown as { weft?: unknown }).weft = { approval: { endorseRefresh: () => Promise.resolve(sets) } };
    expect(await refreshEndorsements()).toBe(sets);
  });
});
