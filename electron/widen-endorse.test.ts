// Main's passkey endorsements for workers (electron/widen-endorse.cjs): the whole set per worker with a growing
// generation, byte for byte what a worker checks (lib/host-endorse.ts), Touch ID to widen a set, none to narrow one,
// and unpairing a passkey narrows every worker it was endorsed for.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { endorseMessage as tsEndorse, heldMessage as tsHeld } from "../lib/host-endorse";
import { createHostSigners } from "../lib/host-signers";
import { createEndorsed, endorseMessage, heldMessage, registerWidenEndorse } from "./widen-endorse.cjs";

const safeStorage = () => ({ encryptString: (s: string) => Buffer.from(`sealed:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^sealed:/, "") });

const workerPair = crypto.generateKeyPairSync("ed25519");
const workerSignKey = workerPair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const receipt = (worker: string, generation: number) => ({ generation, sig: crypto.sign(null, Buffer.from(heldMessage({ worker, generation })), workerPair.privateKey).toString("base64") });

type Paired = { id: string; passkey?: { credId: string; publicKey: string } }[];

function setup(over: { confirm?: () => Promise<boolean>; passkeys?: Paired } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-endorse-"));
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKey = Buffer.from(pair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
  const signer = { sign: (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64") };
  const map = new Map<string, (...args: unknown[]) => unknown>();
  const confirm = vi.fn(over.confirm ?? (() => Promise.resolve(true)));
  const paired: { list: Paired } = { list: over.passkeys ?? [{ id: "b1", passkey: { credId: "Y3JlZA", publicKey: "cGstMQ" } }, { id: "p1" }] };
  let clock = 5_000;
  registerWidenEndorse((channel: string, fn: (...args: unknown[]) => unknown) => void map.set(channel, fn), {
    signer,
    macDevice: () => "mac-1",
    confirm,
    passkeys: () => paired.list,
    endorsed: createEndorsed({ dir, safeStorage }),
    workerName: (id: string) => (id === "w1" ? "m1mini" : null),
    workerSignKey: (id: string) => (id === "nokey" ? null : workerSignKey),
    now: () => clock,
  });
  const call = (channel: string, ...args: unknown[]) => map.get(channel)?.(...args) as Promise<Record<string, unknown>[] | null>;
  const pending = async () => (await call("approval:endorse-refresh")) as unknown as { worker: string; generation: number; endorsements: Record<string, unknown>[] }[];
  return { call, pending, confirm, paired, publicKey, dir, tick: () => (clock += 1) };
}

describe("main's endorsement message", () => {
  it("agrees with the worker's, whatever order the passkeys come in", () => {
    const e = { worker: "w", passkeys: [{ device: "b", credId: "c", publicKey: "k" }, { device: "a", credId: "c", publicKey: "k" }], generation: 2, issuedAt: 3 };
    expect(endorseMessage(e)).toBe(tsEndorse(e));
    expect(endorseMessage({ ...e, passkeys: [...e.passkeys].reverse() })).toBe(endorseMessage(e));
    expect(heldMessage({ worker: "w", generation: 2 })).toBe(tsHeld({ worker: "w", generation: 2 }));
  });
});

describe("the endorse IPC", () => {
  it("endorses every paired passkey for a worker after one Touch ID, naming it, and a worker that pinned this Mac takes it", async () => {
    const h = setup();
    const [e] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    expect(h.confirm).toHaveBeenCalledWith(expect.stringMatching(/^let your paired passkey approve .* on the worker m1mini \(w1\)$/));
    expect(e).toMatchObject({ worker: "w1", passkeys: [{ device: "b1", credId: "Y3JlZA", publicKey: "cGstMQ" }], generation: 5_000, mac: "mac-1" });
    const home = path.join(h.dir, "worker");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify([h.publicKey]));
    const worker = createHostSigners(home, []);
    expect(await worker.endorse(e, "w1", 5_000)).toBe(5_000);
    expect(worker.read().map((p) => p.device)).toEqual(["b1"]);
    // The vault copy is sealed.
    expect(fs.readFileSync(path.join(h.dir, "vault", "endorsed-workers.json"), "utf8")).not.toContain("b1");
  });

  it("keeps a set pending, sent again as it was, until the worker's receipt signed with its pinned key says it holds it", async () => {
    const h = setup();
    const [e] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    expect((await h.pending()).map((p) => p.endorsements[0])).toEqual([e]);
    expect((await h.pending()).map((p) => p.endorsements[0])).toEqual([e]);
    // A receipt nobody signed, signed for another worker, or for an older generation doesn't settle it.
    expect(await h.call("approval:endorse-confirm", { worker: "w1", receipt: { generation: 5_000, sig: "eA" } })).toBe(false);
    expect(await h.call("approval:endorse-confirm", { worker: "w1", receipt: receipt("w2", 5_000) })).toBe(false);
    expect(await h.call("approval:endorse-confirm", { worker: "w1", receipt: receipt("w1", 4_999) })).toBe(false);
    expect(await h.pending()).toHaveLength(1);
    expect(await h.call("approval:endorse-confirm", { worker: "w1", receipt: receipt("w1", 5_000) })).toBe(true);
    expect(await h.pending()).toEqual([]);
    // No sign key pinned for a worker, no record, or no worker: nothing confirms.
    expect(await h.call("approval:endorse-confirm", { worker: "nokey", receipt: receipt("nokey", 1) })).toBe(false);
    await expect(h.call("approval:endorse-confirm", { worker: "a b" })).rejects.toThrow(/names no worker/);
  });

  it("revokes a worker's passkeys with no Touch ID, and a newer generation every time", async () => {
    const h = setup();
    const [first] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    const [none] = (await h.call("approval:endorse", { worker: "w1", revoke: true })) ?? [];
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(none).toMatchObject({ passkeys: [] });
    expect(Number(none?.generation)).toBeGreaterThan(Number(first?.generation));
  });

  it("narrows every endorsed worker once a passkey is unpaired, without Touch ID, and stays pending until each confirms", async () => {
    const h = setup();
    await h.call("approval:endorse", { worker: "w1" });
    await h.call("approval:endorse", { worker: "w2" });
    await h.call("approval:endorse-confirm", { worker: "w1", receipt: receipt("w1", 5_000) });
    h.paired.list = [{ id: "p1" }];
    h.tick();
    const sets = await h.pending();
    expect(sets.map((s) => s.worker)).toEqual(["w1", "w2"]);
    expect(sets.every((s) => (s.endorsements[0]?.passkeys as unknown[]).length === 0)).toBe(true);
    expect(h.confirm).toHaveBeenCalledTimes(2);
    // The same narrowed set again, not a new one each time.
    expect((await h.pending()).map((s) => s.generation)).toEqual(sets.map((s) => s.generation));
  });

  it("drops a device id paired again with a new passkey: only the exact credential it endorsed stays", async () => {
    const h = setup();
    await h.call("approval:endorse", { worker: "w1" });
    h.paired.list = [{ id: "b1", passkey: { credId: "bmV3", publicKey: "a2V5" } }];
    const [set] = await h.pending();
    expect(set?.endorsements[0]?.passkeys).toEqual([]);
  });

  it("says when there's nothing to endorse, signs nothing when refused, and wants a worker", async () => {
    expect(await setup({ passkeys: [] }).call("approval:endorse", { worker: "w1" })).toEqual([]);
    expect(await setup({ confirm: () => Promise.resolve(false) }).call("approval:endorse", { worker: "w1" })).toBeNull();
    await expect(setup().call("approval:endorse", { worker: "a b" })).rejects.toThrow(/names no worker/);
    await expect(setup().call("approval:endorse", null)).rejects.toThrow(/names no worker/);
    const h = setup({ passkeys: [{ id: "b1", passkey: { credId: "Y", publicKey: "k" } }, { id: "b2", passkey: { credId: "Z", publicKey: "k" } }] });
    await h.call("approval:endorse", { worker: "w9" });
    expect(h.confirm).toHaveBeenCalledWith(expect.stringMatching(/^let your 2 paired passkeys .* on the worker w9$/));
  });

  it("reads a garbled record as no workers endorsed", async () => {
    const h = setup();
    fs.mkdirSync(path.join(h.dir, "vault"), { recursive: true });
    fs.writeFileSync(path.join(h.dir, "vault", "endorsed-workers.json"), "nope");
    expect(await h.call("approval:endorse-refresh")).toEqual([]);
  });
});
