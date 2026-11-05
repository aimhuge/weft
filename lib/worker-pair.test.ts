// `weft-worker enrol wph.…` (lib/worker-pair.ts) against a fake of the three SQL functions and main's real check
// (electron/host-pairing.cjs), so the claim the box sends is one the Mac accepts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkHostClaim } from "../electron/host-pairing.cjs";
import { keyHash, newPairSecret, newSignKeys, pairCode } from "./host-pairing";
import { PAIR_POLL_MS, PAIR_WAIT_MS, pairWorker, workerSignKeys } from "./worker-pair";
import type { Rpc } from "./worker-registry";

const ID = "11111111-2222-4333-8444-555555555555";
const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const secret = newPairSecret();
const CODE = pairCode({ id: ID, orgId: ORG, secret });
const KEY = `wwk_${"c".repeat(64)}`;
const box = { name: "m1mini", platform: "darwin", arch: "arm64", boxKey: "Ym94", sign: newSignKeys() };

// The functions, faked: a claim lands once; status answers the claimed key with each answer in turn.
function fakeRpc({ claimed = true, statuses = [{ status: "paired", worker_id: "w1", org_id: ORG, owner_user: "u1", device: "worker:w1" }] as unknown[], error = null as { message: string } | null } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let i = 0;
  const rpc: Rpc = (fn, args) => {
    calls.push({ fn, args });
    if (error) return Promise.resolve({ data: null, error });
    if (fn === "worker_pair_claim") return Promise.resolve({ data: claimed, error: null });
    if (args.p_key !== KEY) return Promise.resolve({ data: null, error: { message: "unknown worker pairing" } });
    return Promise.resolve({ data: statuses[Math.min(i++, statuses.length - 1)], error: null });
  };
  return { rpc, calls };
}

const deps = (rpc: Rpc, over: Record<string, unknown> = {}) => ({ rpc, say: vi.fn(), sleep: vi.fn(() => Promise.resolve()), makeKey: () => KEY, ...over });

describe("pairWorker", () => {
  it("claims with keys main accepts, says the check code, and comes back enrolled", async () => {
    const { rpc, calls } = fakeRpc();
    const d = deps(rpc);
    const config = await pairWorker(` ${CODE} `, box, d);
    expect(config).toEqual({ workerId: "w1", orgId: ORG, ownerUser: "u1", device: "worker:w1", key: KEY, name: "m1mini" });
    const claim = calls[0]!.args;
    expect(claim).toMatchObject({ p_pairing: ID, p_key_hash: keyHash(KEY), p_box_key: "Ym94", p_sign_key: box.sign.publicKey });
    expect(JSON.stringify(claim)).not.toContain(KEY);
    expect(JSON.stringify(claim)).not.toContain(secret);
    const row = { kind: "worker", name: claim.p_name, platform: claim.p_platform, arch: claim.p_arch, box_key: claim.p_box_key, sign_key: claim.p_sign_key, key_hash: claim.p_key_hash, proof: claim.p_proof, sig: claim.p_sig };
    expect(checkHostClaim({ id: ID, orgId: ORG, secret }, row)).toBeNull();
    expect(d.say).toHaveBeenCalledWith(expect.stringMatching(/Touch ID prompt should show [0-9A-F]{4}-[0-9A-F]{4}\./));
  });

  it("claims under a safe name, and enrols under it", async () => {
    const { rpc, calls } = fakeRpc();
    const config = await pairWorker(CODE, { ...box, name: "Alex's \"mini\"" }, deps(rpc));
    expect(calls[0]!.args.p_name).toBe("Alexs mini");
    expect(config.name).toBe("Alexs mini");
  });

  it("waits while the Mac hasn't confirmed", async () => {
    const { rpc } = fakeRpc({ statuses: [{ status: "claimed" }, { status: "claimed" }, { status: "paired", worker_id: "w1", org_id: ORG, owner_user: "u1", device: "worker:w1" }] });
    const d = deps(rpc);
    await pairWorker(CODE, box, d);
    expect(d.sleep).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(PAIR_POLL_MS);
  });

  it("stops when the Mac says no", async () => {
    const { rpc } = fakeRpc({ statuses: [{ status: "cancelled" }] });
    await expect(pairWorker(CODE, box, deps(rpc))).rejects.toThrow("The Mac didn't pair this box.");
  });

  it("gives up after the code's life", async () => {
    const { rpc } = fakeRpc({ statuses: [{ status: "claimed" }] });
    let t = 0;
    const d = deps(rpc, { now: () => t, sleep: vi.fn(() => ((t += PAIR_WAIT_MS / 2), Promise.resolve())) });
    await expect(pairWorker(CODE, box, d)).rejects.toThrow("didn't confirm in time");
  });

  it("refuses a code that's taken, broken, or a server that errs", async () => {
    await expect(pairWorker(CODE, box, deps(fakeRpc({ claimed: false }).rpc))).rejects.toThrow("used or expired");
    await expect(pairWorker("wph.nope", box, deps(fakeRpc().rpc))).rejects.toThrow("isn't whole");
    await expect(pairWorker(CODE, box, deps(fakeRpc({ error: { message: "boom" } }).rpc))).rejects.toThrow("worker_pair_claim: boom");
  });

  it("doesn't take a paired answer missing its worker", async () => {
    const { rpc } = fakeRpc({ statuses: [{ status: "paired" }, { status: "cancelled" }] });
    await expect(pairWorker(CODE, box, deps(rpc))).rejects.toThrow("didn't pair");
  });

  it("makes its own key and waits on real timers by default", async () => {
    vi.useFakeTimers();
    const calls: Record<string, unknown>[] = [];
    const rpc: Rpc = (fn, args) => {
      calls.push(args);
      const paired = calls.length > 2;
      return Promise.resolve(fn === "worker_pair_claim" ? { data: true, error: null } : { data: paired ? { status: "paired", worker_id: "w", org_id: ORG, owner_user: "u", device: "worker:w" } : { status: "claimed" }, error: null });
    };
    const pending = pairWorker(CODE, box, { rpc, say: () => {} });
    await vi.advanceTimersByTimeAsync(PAIR_POLL_MS);
    const config = await pending;
    vi.useRealTimers();
    expect(config.key).toMatch(/^wwk_[0-9a-f]{64}$/);
    expect(calls[0]!.p_key_hash).toBe(keyHash(config.key));
  });
});

describe("workerSignKeys", () => {
  it("makes the pair once, mode 600, and reads it back after", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sign-"));
    const make = vi.fn(newSignKeys);
    const first = workerSignKeys(path.join(home, "w"), make);
    expect(workerSignKeys(path.join(home, "w"), make)).toEqual(first);
    expect(make).toHaveBeenCalledTimes(1);
    expect(fs.statSync(path.join(home, "w", "sign-key.json")).mode & 0o777).toBe(0o600);
  });

  it("replaces a damaged file", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sign-"));
    fs.writeFileSync(path.join(home, "sign-key.json"), '{"publicKey":1}');
    const keys = workerSignKeys(home, newSignKeys);
    expect(typeof keys.publicKey).toBe("string");
  });
});
