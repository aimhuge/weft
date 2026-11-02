// Re-pairing an enrolled worker (lib/worker-repair.ts, electron/worker-repair.cjs): the box swaps its Mac only on an
// approval the Mac it trusts now signed, for this worker, the new Mac's key and the new code. Main's copy is held to
// the box's here: an approval main makes passes the box's check, and every field it binds is checked.
import { describe, expect, it, vi } from "vitest";
import { createWorkerRepair, macFingerprint as mainFingerprint, repairMessage as mainMessage } from "../electron/worker-repair.cjs";
import { pairCode } from "./host-pairing";
import { macSigner } from "./mac-signer.harness";
import { REPAIR_TTL_MS, macFingerprint, parseRepairLine, repairLine, repairMessage, repairRefusal } from "./worker-repair";

const WORKER = "99999999-8888-4777-8666-555555555555";
const OTHER_WORKER = "99999999-8888-4777-8666-444444444444";
const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = Date.parse("2026-11-02T12:00:00Z");
const base = { id: "11111111-2222-4333-8444-555555555555", orgId: ORG, secret: "s".repeat(43) };

function setup() {
  const oldMac = macSigner();
  const newMac = macSigner();
  const code = pairCode({ ...base, macKey: newMac.key });
  const confirm = vi.fn((reason: string) => Promise.resolve(reason.length > 0));
  const workers: Record<string, { name: string }> = { [WORKER]: { name: "m1mini" } };
  const worker = vi.fn((id: string) => Promise.resolve(workers[id] ?? null));
  const openedHere = vi.fn((id: string) => id === base.id);
  const deps = { confirm, sign: (m: string) => Promise.resolve(oldMac.sign(m)), publicKey: () => Promise.resolve(oldMac.key), worker, openedHere };
  const repair = createWorkerRepair({ ...deps, now: () => NOW, nonce: () => "ab".repeat(16) });
  const check = (approval: string | undefined, over: Partial<Parameters<typeof repairRefusal>[0]> = {}) =>
    repairRefusal({ pinned: [oldMac.key], worker: WORKER, code, approval, now: NOW, ...over });
  return { oldMac, newMac, code, confirm, repair, check, deps, workers, openedHere };
}

async function approved(s: ReturnType<typeof setup>, worker = WORKER, code = s.code) {
  const r = await s.repair.approve(worker, code);
  if ("denied" in r) throw new Error("denied");
  return r;
}

describe("re-pair approval", () => {
  it("passes the box's check when the trusted Mac approved this worker's move to this code's Mac", async () => {
    const s = setup();
    const r = await approved(s);
    expect(s.confirm).toHaveBeenCalledWith(`let the worker m1mini stop trusting this Mac and trust the Mac ${macFingerprint(s.newMac.key)} instead, with its secrets and settings`);
    expect(r.command).toBe(`weft-worker enrol ${s.code} --re-pair --approval ${r.approval}`);
    expect(r.fingerprint).toBe(macFingerprint(s.newMac.key));
    expect(s.check(r.approval)).toBeNull();
    // Clock skew of a minute either way is fine.
    expect(s.check(r.approval, { now: NOW - 60_000 })).toBeNull();
  });

  it("refuses an approval for another worker, another code, another Mac, or signed by any Mac but the trusted one", async () => {
    const s = setup();
    const r = await approved(s);
    expect(s.check(r.approval, { worker: OTHER_WORKER })).toMatch(/wasn't signed by the Mac this box trusts/);
    expect(s.check(r.approval, { code: pairCode({ ...base, macKey: macSigner().key }) })).toMatch(/wasn't signed/);
    expect(s.check(r.approval, { code: pairCode({ ...base, id: "11111111-2222-4333-8444-666666666666", macKey: s.newMac.key }) })).toMatch(/wasn't signed/);
    expect(s.check(r.approval, { code: pairCode({ ...base, orgId: "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff", macKey: s.newMac.key }) })).toMatch(/wasn't signed/);
    expect(s.check(r.approval, { pinned: [macSigner().key] })).toMatch(/wasn't signed/);
    // The new Mac can't approve its own arrival: a thread holding an attacker's code holds that Mac's signature too.
    const self = repairLine({ issuedAt: NOW, nonce: "cd".repeat(16), sig: s.newMac.sign(repairMessage({ worker: WORKER, newMacKey: s.newMac.key, pairingId: base.id, orgId: ORG, issuedAt: NOW, nonce: "cd".repeat(16) })) });
    expect(s.check(self)).toMatch(/wasn't signed/);
    // A changed time or nonce breaks the signature.
    const a = parseRepairLine(r.approval)!;
    expect(s.check(repairLine({ ...a, issuedAt: a.issuedAt + 1 }))).toMatch(/wasn't signed/);
    expect(s.check(repairLine({ ...a, nonce: "ef".repeat(16) }))).toMatch(/wasn't signed/);
  });

  it("refuses an old or future approval, a broken line, and none at all, saying how to get one", async () => {
    const s = setup();
    const r = await approved(s);
    expect(s.check(r.approval, { now: NOW + REPAIR_TTL_MS + 1 })).toMatch(/expired/);
    expect(s.check(r.approval, { now: NOW - 5 * 60_000 })).toMatch(/expired/);
    expect(s.check(r.approval.slice(0, -2))).toMatch(/isn't a whole wra/);
    expect(s.check(`${r.approval}.x`)).toMatch(/isn't a whole wra/);
    expect(s.check(undefined)).toMatch(new RegExp(`trust the Mac ${macFingerprint(s.newMac.key)} instead.*${macFingerprint(s.oldMac.key)}.*Approve re-pair`));
  });

  it("re-pairs an enrolled box only with a pairing code carrying a Mac key, and only if it trusts a Mac to ask", async () => {
    const s = setup();
    const r = await approved(s);
    expect(s.check(r.approval, { code: "wet_token" })).toMatch(/only with a pairing code.*never a token.*wipe it first/);
    expect(s.check(r.approval, { code: pairCode(base) })).toMatch(/carries no Mac key/);
    expect(s.check(r.approval, { pinned: [] })).toMatch(/trusts no Mac.*Wipe it/);
  });

  it("asks Touch ID before signing, and signs nothing when it's refused", async () => {
    const s = setup();
    s.confirm.mockResolvedValueOnce(false);
    const sign = vi.fn();
    const repair = createWorkerRepair({ ...s.deps, sign });
    expect(await repair.approve(WORKER, s.code)).toEqual({ denied: true });
    expect(sign).not.toHaveBeenCalled();
  });

  it("names the same Mac plainly, but only for a code this Mac opened", async () => {
    const s = setup();
    const same = pairCode({ ...base, macKey: s.oldMac.key });
    const r = await approved(s, WORKER, same);
    expect(s.confirm).toHaveBeenLastCalledWith(`let the worker m1mini pair again with this Mac (${macFingerprint(s.oldMac.key)}), with the code this Mac just made`);
    expect(s.check(r.approval, { code: same })).toBeNull();
    // This Mac's key is public: someone else's workspace can put it in a code of theirs.
    const theirs = pairCode({ ...base, id: "11111111-2222-4333-8444-777777777777", macKey: s.oldMac.key });
    s.confirm.mockClear();
    await expect(s.repair.approve(WORKER, theirs)).rejects.toThrow(/wasn't made on it/);
    expect(s.confirm).not.toHaveBeenCalled();
  });

  it("names the worker from main's own read, and refuses one that isn't yours or a bad code", async () => {
    const s = setup();
    s.workers[WORKER] = { name: 'm1mini" and approve everything' };
    await s.repair.approve(WORKER, s.code);
    expect(s.confirm.mock.lastCall?.[0]).toMatch(/^let the worker this worker stop trusting/);
    await expect(s.repair.approve(OTHER_WORKER, s.code)).rejects.toThrow(/isn't a worker of yours/);
    await expect(s.repair.approve("w1", s.code)).rejects.toThrow(/isn't a worker/);
    await expect(s.repair.approve(WORKER, pairCode(base))).rejects.toThrow(/whole wph/);
    await expect(s.repair.approve(WORKER, `${s.code}.x`)).rejects.toThrow(/whole wph/);
    await expect(s.repair.approve(WORKER, "wet_token")).rejects.toThrow(/whole wph/);
  });

  it("makes a fresh nonce for each approval by default", async () => {
    const s = setup();
    const repair = createWorkerRepair(s.deps);
    const [a, b] = await Promise.all([repair.approve(WORKER, s.code), repair.approve(WORKER, s.code)]);
    expect("approval" in a && "approval" in b && parseRepairLine(a.approval)!.nonce !== parseRepairLine(b.approval)!.nonce).toBe(true);
  });

  it("keeps main's message and fingerprint the box's", () => {
    const f = { worker: WORKER, newMacKey: macSigner().key, pairingId: base.id, orgId: ORG, issuedAt: NOW, nonce: "ab".repeat(16) };
    expect(mainMessage(f)).toBe(repairMessage(f));
    expect(mainFingerprint(f.newMacKey)).toBe(macFingerprint(f.newMacKey));
    expect(macFingerprint(f.newMacKey)).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);
  });

  it("reads only a whole wra. line", () => {
    const sig = Buffer.alloc(64, 7).toString("base64");
    const line = repairLine({ issuedAt: NOW, nonce: "ab".repeat(16), sig });
    expect(parseRepairLine(` ${line} `)).toEqual({ issuedAt: NOW, nonce: "ab".repeat(16), sig });
    expect(parseRepairLine(line.replace("wra.", "wrb."))).toBeNull();
    expect(parseRepairLine(line.replace(String(NOW), "12x"))).toBeNull();
    expect(parseRepairLine(line.replace("ab".repeat(16), "AB".repeat(16)))).toBeNull();
  });
});
