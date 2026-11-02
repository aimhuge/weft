// Main's passkey endorsements for workers (electron/widen-endorse.cjs): the whole set per worker with a growing
// generation, byte for byte what a worker checks (lib/host-endorse.ts), Touch ID to widen a set, none to narrow one,
// and unpairing a passkey narrows every worker it was endorsed for.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { endorseMessage as tsEndorse } from "../lib/host-endorse";
import { createHostSigners } from "../lib/host-signers";
import { createEndorsed, endorseMessage, registerWidenEndorse } from "./widen-endorse.cjs";

const safeStorage = () => ({ encryptString: (s: string) => Buffer.from(`sealed:${s}`), decryptString: (b: Buffer) => b.toString().replace(/^sealed:/, "") });

function setup(over: { confirm?: () => Promise<boolean>; passkeys?: { id: string; passkey?: { credId: string; publicKey: string } }[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-endorse-"));
  const pair = crypto.generateKeyPairSync("ed25519");
  const publicKey = Buffer.from(pair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
  const signer = { sign: (m: string) => crypto.sign(null, Buffer.from(m), pair.privateKey).toString("base64") };
  const map = new Map<string, (...args: unknown[]) => unknown>();
  const confirm = vi.fn(over.confirm ?? (() => Promise.resolve(true)));
  const paired = { list: over.passkeys ?? [{ id: "b1", passkey: { credId: "Y3JlZA", publicKey: "cGstMQ" } }, { id: "p1" }] };
  let clock = 5_000;
  registerWidenEndorse((channel: string, fn: (...args: unknown[]) => unknown) => void map.set(channel, fn), {
    signer,
    macDevice: () => "mac-1",
    confirm,
    passkeys: () => paired.list,
    endorsed: createEndorsed({ dir, safeStorage }),
    now: () => clock,
  });
  const call = (channel: string, ...args: unknown[]) => map.get(channel)?.(...args) as Promise<Record<string, unknown>[] | null>;
  return { call, confirm, paired, publicKey, dir, tick: () => (clock += 1) };
}

describe("main's endorsement message", () => {
  it("agrees with the worker's, whatever order the passkeys come in", () => {
    const e = { worker: "w", passkeys: [{ device: "b", credId: "c", publicKey: "k" }, { device: "a", credId: "c", publicKey: "k" }], generation: 2, issuedAt: 3 };
    expect(endorseMessage(e)).toBe(tsEndorse(e));
    expect(endorseMessage({ ...e, passkeys: [...e.passkeys].reverse() })).toBe(endorseMessage(e));
  });
});

describe("the endorse IPC", () => {
  it("endorses every paired passkey for a worker after one Touch ID, and a worker that pinned this Mac takes it", async () => {
    const h = setup();
    const [e] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    expect(h.confirm).toHaveBeenCalledWith(expect.stringMatching(/^let your paired passkey approve/));
    expect(e).toMatchObject({ worker: "w1", passkeys: [{ device: "b1", credId: "Y3JlZA", publicKey: "cGstMQ" }], generation: 5_000, mac: "mac-1" });
    const home = path.join(h.dir, "worker");
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, "mac-keys.json"), JSON.stringify([h.publicKey]));
    const worker = createHostSigners(home, []);
    await worker.endorse(e, "w1", 5_000);
    expect(worker.read().map((p) => p.device)).toEqual(["b1"]);
    // The vault copy is sealed.
    expect(fs.readFileSync(path.join(h.dir, "vault", "endorsed-workers.json"), "utf8")).not.toContain("b1");
  });

  it("revokes a worker's passkeys with no Touch ID, and a newer generation every time", async () => {
    const h = setup();
    const [first] = (await h.call("approval:endorse", { worker: "w1" })) ?? [];
    const [none] = (await h.call("approval:endorse", { worker: "w1", revoke: true })) ?? [];
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(none).toMatchObject({ passkeys: [] });
    expect(Number(none?.generation)).toBeGreaterThan(Number(first?.generation));
  });

  it("narrows every endorsed worker once a passkey is unpaired, without Touch ID", async () => {
    const h = setup();
    await h.call("approval:endorse", { worker: "w1" });
    await h.call("approval:endorse", { worker: "w2" });
    h.paired.list = [{ id: "p1" }];
    h.tick();
    const sets = (await h.call("approval:endorse-refresh")) as unknown as { worker: string; endorsements: Record<string, unknown>[] }[];
    expect(sets.map((s) => s.worker)).toEqual(["w1", "w2"]);
    expect(sets.every((s) => (s.endorsements[0]?.passkeys as unknown[]).length === 0)).toBe(true);
    expect(h.confirm).toHaveBeenCalledTimes(2);
    // A passkey paired later isn't added by a refresh: that's a widening, which asks Touch ID.
    h.paired.list = [{ id: "b9", passkey: { credId: "bmV3", publicKey: "a2V5" } }];
    const again = (await h.call("approval:endorse-refresh")) as unknown as { endorsements: Record<string, unknown>[] }[];
    expect(again[0]?.endorsements[0]?.passkeys).toEqual([]);
  });

  it("says when there's nothing to endorse, signs nothing when refused, and wants a worker", async () => {
    expect(await setup({ passkeys: [] }).call("approval:endorse", { worker: "w1" })).toEqual([]);
    expect(await setup({ confirm: () => Promise.resolve(false) }).call("approval:endorse", { worker: "w1" })).toBeNull();
    await expect(setup().call("approval:endorse", { worker: "a b" })).rejects.toThrow(/names no worker/);
    await expect(setup().call("approval:endorse", null)).rejects.toThrow(/names no worker/);
    const h = setup({ passkeys: [{ id: "b1", passkey: { credId: "Y", publicKey: "k" } }, { id: "b2", passkey: { credId: "Z", publicKey: "k" } }] });
    await h.call("approval:endorse", { worker: "w1" });
    expect(h.confirm).toHaveBeenCalledWith(expect.stringMatching(/^let your 2 paired passkeys/));
  });

  it("reads a garbled record as no workers endorsed", async () => {
    const h = setup();
    fs.mkdirSync(path.join(h.dir, "vault"), { recursive: true });
    fs.writeFileSync(path.join(h.dir, "vault", "endorsed-workers.json"), "nope");
    expect(await h.call("approval:endorse-refresh")).toEqual([]);
  });
});
